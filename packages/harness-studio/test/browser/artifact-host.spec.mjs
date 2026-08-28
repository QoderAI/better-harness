import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { HarnessRunEmitter } from "@qoder-ai/harness/exec";
import { buildHarnessInspectorReport, emptyFeatureTree } from "../../../../scripts/harness-inspector/index.mjs";
import { startHarnessStudioServer } from "../../dist/server/server.js";
import { sessionFromRetainedRun } from "../../dist/server/debugger-session-transform.js";
import { createDocxFixture } from "../docx-fixture.ts";
import { createPptxFixture } from "../pptx-fixture.ts";
import { createXlsxFixture } from "../xlsx-fixture.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACT_PREVIEW_PANEL_ID = "artifact-preview-panel";
const canvasSdkRoot = process.env.CANVAS_SDK_ROOT ?? resolve(packageRoot, "../../../canvas-sdk");
// Native fallback coverage must not vary with the viewers installed in the
// developer's home directory. Provisioned viewer behavior has its own provider
// and server contract tests.
const canvasViewerRoot = resolve(packageRoot, "test/fixtures/missing-canvas-viewers");
let studio;
let emptyStudio;
let selectedWorkspace;
let artifactDirectory;

test.beforeAll(async () => {
  artifactDirectory = await mkdtemp(join(tmpdir(), "studio-artifact-browser-"));
  await writeFile(join(artifactDirectory, "document.docx"), createDocxFixture("Studio Word Fixture"));
  await writeFile(join(artifactDirectory, "deck.pptx"), createPptxFixture("01"));
  await writeFile(join(artifactDirectory, "workbook.xlsx"), createXlsxFixture());
  await writeFile(join(artifactDirectory, "component.canvas.tsx"), 'document.body.dataset.moduleEvaluated = "yes"; export default () => <p data-preview="current">first render</p>;\n', "utf8");
  await writeFile(join(artifactDirectory, "orders.agent.canvas.tsx"), agentReactSource("first verified build"), "utf8");
  await writeFile(join(artifactDirectory, "fallback.canvas.tsx"), 'export default () => <p data-preview="canvas-fallback">Studio React fallback</p>;\n', "utf8");
  await writeFile(join(artifactDirectory, "broken.canvas.tsx"), 'export default () => <main>broken;\n', "utf8");
  await writeFile(join(artifactDirectory, "throws.canvas.tsx"), 'export default function Boom() { throw new Error("render exploded"); }\n', "utf8");
  await writeFile(join(artifactDirectory, "late-throw.canvas.tsx"), [
    'import { useEffect } from "react";',
    "export default function Late() {",
    '  useEffect(() => { setTimeout(() => { throw new Error("late boom"); }, 0); }, []);',
    '  return <p data-preview="late">mounted</p>;',
    "}",
  ].join("\n"), "utf8");
  await writeFile(join(artifactDirectory, "change.patch"), [
    "diff --git a/example.ts b/example.ts",
    "--- a/example.ts",
    "+++ b/example.ts",
    "@@ -1 +1 @@",
    "-const value = 1;",
    "+const value = 2;",
    "diff --git a/guide.md b/guide.md",
    "--- a/guide.md",
    "+++ b/guide.md",
    "@@ -1 +1,2 @@",
    " # Artifact diff",
    "+Second file remains visible.",
  ].join("\n"), "utf8");
  await writeFile(join(artifactDirectory, "diagram.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><script>parent.document.body.dataset.svgExecuted="yes"</script><text x="12" y="44">Safe SVG artifact</text></svg>', "utf8");
  await writeFile(join(artifactDirectory, "diagram.mmd"), "---\ntitle: Fixture diagram\n---\ngraph TD\n  Start --> Finish\n", "utf8");
  await writeFile(join(artifactDirectory, "invalid.mmd"), "not a supported diagram\n", "utf8");
  await writeFile(join(artifactDirectory, "notes.txt"), "followed the declared content reference\n", "utf8");
  await writeFile(join(artifactDirectory, "badge.png"), Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFUlEQVR42mNk+M9QzzCKRsEoGgWjAABtVwPTBxjKUAAAAABJRU5ErkJggg==",
    "base64",
  ));
  await writeFile(join(artifactDirectory, "report.md"), [
    "# Run report",
    "",
    "A paragraph with **bold**, `code`, a [safe link](https://example.com/page),",
    "a [blocked link](javascript:alert(1)) and an ![inline badge](./badge.png).",
    "",
    "## Findings",
    "",
    "- [x] closed the loop",
    "- [ ] still open",
    "",
    "| Check | Result |",
    "| :---- | -----: |",
    "| parse | 12 |",
    "",
    "```ts",
    "const finding = 1;",
    "```",
    "",
    '<img src=x onerror="document.body.dataset.markdownExecuted = \'yes\'">',
    "",
    "### Deep detail",
    "",
    "Back to [Findings](#findings).",
  ].join("\n"), "utf8");
  studio = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    artifactDirectory,
    canvasSdkRoot,
    canvasViewerRoot,
    port: 0,
  });
  selectedWorkspace = await mkdtemp(join(tmpdir(), "studio-project-workspace-"));
  const retainedRun = (id, savedAt, prompt, tools) => ({
    id,
    savedAt,
    prompt,
    status: "finished",
    toolCallCount: tools.length,
    warnings: [],
    timeline: [
      ...tools.map((name, index) => ({ kind: "tool-call", id: `tool_${index}`, name, argsText: "{}", status: "completed", resultText: "ok" })),
      { kind: "message", id: "message_1", text: `${prompt} complete`, complete: true },
    ],
  });
  const workspaceRecords = [
    retainedRun("run_left", "2026-08-20T10:00:00.000Z", "Repair parser", ["Read", "Edit", "Bash"]),
    retainedRun("run_right", "2026-08-20T11:00:00.000Z", "Repair renderer", ["Read", "Bash"]),
  ];
  const workspaceInspectorReport = buildHarnessInspectorReport({
    repoRoot: selectedWorkspace,
    featureTree: emptyFeatureTree(),
    sessions: workspaceRecords.map((record) => ({
      sessionId: record.id,
      platform: "qoder",
      firstSeen: record.savedAt,
      lastSeen: record.savedAt,
      prompts: [{ text: record.prompt, timestamp: record.savedAt }],
      promptCount: 1,
      assistantMessageCount: 1,
      toolCallCount: record.toolCallCount,
      toolActivity: {
        calls: record.timeline.filter((event) => event.kind === "tool-call").map((event, index) => ({
          id: event.id,
          family: event.name === "Edit" ? "change" : "inspect",
          actionLabel: `${event.name} workspace evidence`,
          toolName: event.name,
          status: "completed",
          startedAt: Date.parse(record.savedAt) + index,
          durationMs: index + 1,
          durationStatus: "observed",
          filePaths: event.name === "Edit" ? ["src/renderer.ts"] : [],
        })),
      },
      dialogue: { turns: [{
        index: 1,
        anchorId: "turn-1",
        prompt: { text: record.prompt, timestamp: record.savedAt },
        steps: record.timeline.filter((event) => event.kind === "tool-call").map((event) => ({ kind: "tool", callId: event.id, toolName: event.name })),
        toolCallCount: record.toolCallCount,
        response: `${record.prompt} complete`,
        responseStatus: "retained",
      }] },
    })),
    correlation: { commits: [] },
    providers: [{ platform: "qoder", status: "ok", discovered: 2, included: 2 }],
    filters: { platform: "all", sessionLimit: 100 },
  });
  emptyStudio = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    canvasSdkRoot,
    canvasViewerRoot,
    port: 0,
    workspaceDirectoryPicker: async () => selectedWorkspace,
    workspaceSessionProvider: {
      discover: async () => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_200));
        return {
          label: "fixture-project",
          providers: [{ provider: "qoder", status: "ok", discovered: 2, included: 2 }],
          inspectorReport: workspaceInspectorReport,
          sessions: workspaceRecords.map((record) => ({
            summary: { id: `qoder:${record.id}`, savedAt: record.savedAt, prompt: record.prompt, status: "observed", toolCallCount: record.toolCallCount, provider: "qoder", messageCount: 1, warningCount: 0 },
            debugger: { ...sessionFromRetainedRun(record), id: `qoder:${record.id}`, agent: "qoder", protocol: "Inspector normalized local evidence", connection: "observed" },
          })),
        };
      },
    },
    executorFactory: (context) => ({
      host: "qoder",
      async execute(revision, _bundle, task) {
        const emitter = new HarnessRunEmitter(context.onRunEvent);
        emitter.start({ revisionId: revision.revisionId, host: "qoder" });
        emitter.text(`default harness: ${task.prompt}`);
        emitter.finish(0);
        return {
          host: "qoder",
          revisionId: revision.revisionId,
          exitCode: 0,
          output: `default harness: ${task.prompt}`,
          errorOutput: "",
          warnings: [],
        };
      },
    }),
  });
});

test.afterAll(async () => {
  await studio?.close();
  await emptyStudio?.close();
  if (artifactDirectory) await rm(artifactDirectory, { recursive: true, force: true });
  if (selectedWorkspace) await rm(selectedWorkspace, { recursive: true, force: true });
});

function watchFailures(page) {
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("pageerror", (error) => failures.push(error.message));
  return failures;
}

function agentReactSource(label, throwMessage, lateThrowMessage) {
  return [
    'import { defineArtifactView, useArtifactAction, useArtifactState } from "@studio/agent-react";',
    "function Orders() {",
    ...(throwMessage === undefined ? [] : [`  throw new Error(${JSON.stringify(throwMessage)});`]),
    '  const [orders, setOrders] = useArtifactState<readonly string[]>("/orders");',
    '  const showSource = useArtifactAction("studio.show-source");',
    "  const addOrder = () => setOrders([...orders, `order-${orders.length + 1}`]);",
    "  const openSource = () => { void showSource(); };",
    ...(lateThrowMessage === undefined ? [] : [`  const breakCurrent = () => { setTimeout(() => { throw new Error(${JSON.stringify(lateThrowMessage)}); }, 0); };`]),
    '  return <main data-agent-react-build={"' + label + '"}>',
    "    <h1>Orders AgentReact</h1>",
    '    <p data-agent-react-label>{"' + label + '"}</p>',
    "    <output aria-label=\"Order count\">{orders.length}</output>",
    "    <button type=\"button\" onClick={addOrder}>Add order</button>",
    "    <button type=\"button\" onClick={openSource}>Show source</button>",
    ...(lateThrowMessage === undefined ? [] : ['    <button type="button" onClick={breakCurrent}>Break current</button>']),
    "  </main>;",
    "}",
    "export default defineArtifactView({",
    '  id: "orders",',
    '  state: { "/orders": { schema: "list", version: 1 } },',
    '  capabilities: ["studio.show-source"],',
    "  component: Orders,",
    "});",
    "",
  ].join("\n");
}

async function openArtifacts(page) {
  await page.goto(`${studio.url}/#/artifacts`);
  const artifactsPaneTab = page.getByRole("tab", { name: "Artifacts", exact: true });
  if ((page.viewportSize()?.width ?? 0) <= 760) {
    await expect(artifactsPaneTab).toBeVisible({ timeout: 15_000 });
    if (await artifactsPaneTab.getAttribute("aria-selected") !== "true") await artifactsPaneTab.click();
  }
  // The first viewer discovery can be cold on machines with a provisioned
  // Canvas catalog, so wait for the catalog boundary instead of assuming a
  // five-second filesystem scan.
  await expect(page.locator(".artifact-list-pane").getByRole("button", { name: /component\.canvas\.tsx/ })).toBeVisible({ timeout: 15_000 });
}

test("renders generated TSX in the sandbox and keeps its source reachable", async ({ page }, testInfo) => {
  const failures = watchFailures(page);
  await openArtifacts(page);
  await page.getByRole("button", { name: /component\.canvas\.tsx/ }).click();
  const preview = page.frameLocator('iframe[title="Live artifact preview: component.canvas.tsx"]');
  await expect(preview.locator('[data-preview="current"]')).toHaveText("first render");
  await expect(preview.locator("body")).toHaveAttribute("data-module-evaluated", "yes");
  await expect(preview.locator("html")).toHaveAttribute("data-artifact-theme", "dark");
  const previewContrast = await preview.locator('[data-preview="current"]').evaluate((element) => {
    const channels = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = (value) => channels(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(getComputedStyle(document.body).backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(previewContrast).toBeGreaterThanOrEqual(4.5);
  await expect(page.getByText("Preview rendered from the current build.")).toBeVisible();
  await expect(page.locator('[data-preview="current"]')).toHaveCount(0);
  // The frame learns the theme once during the handshake, so a later toggle has
  // to reach it over the same channel rather than leaving it on the old palette.
  await page.getByRole("button", { name: /Dark theme active/ }).click();
  await expect(preview.locator("html")).toHaveAttribute("data-artifact-theme", "light");
  await page.getByRole("button", { name: /Light theme active/ }).click();
  await expect(preview.locator("html")).toHaveAttribute("data-artifact-theme", "dark");
  const frame = page.locator('iframe[title="Live artifact preview: component.canvas.tsx"]');
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  const direct = await page.context().newPage();
  await direct.goto(`${studio.url}${await frame.getAttribute("src")}`);
  await expect(direct.locator('[data-preview="current"]')).toHaveCount(0);
  await expect(direct.locator("body")).not.toHaveAttribute("data-module-evaluated", "yes");
  await direct.close();
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  const source = page.locator('[data-artifact-code-view="source"]');
  await expect(source).toContainText("data-preview");
  await expect(source.locator('[data-highlight-state="highlighted"]')).toBeVisible();
  const darkToken = source.locator('span[style*="color"]').first();
  const darkColor = await darkToken.evaluate((element) => getComputedStyle(element).color);
  await page.getByRole("button", { name: /Dark theme active/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(source.locator('[data-highlight-state="highlighted"]')).toBeVisible();
  await expect.poll(() => darkToken.evaluate((element) => getComputedStyle(element).color)).not.toBe(darkColor);
  await page.screenshot({ path: testInfo.outputPath("artifact-source-highlight-light.png"), fullPage: true });
  expect(failures).toEqual([]);
});

test("keeps an unactivated Canvas TSX file on the Studio React fallback", async ({ page }) => {
  const failures = watchFailures(page);
  await openArtifacts(page);
  await page.getByRole("button", { name: /fallback\.canvas\.tsx/ }).click();
  const preview = page.frameLocator('iframe[title="Live artifact preview: fallback.canvas.tsx"]');
  await expect(preview.locator('[data-preview="canvas-fallback"]')).toHaveText("Studio React fallback");
  const catalog = await (await page.request.get(`${studio.url}/api/artifacts`)).json();
  expect(catalog.artifacts.find((artifact) => artifact.label === "fallback.canvas.tsx")).toMatchObject({
    format: "cursor-canvas-tsx",
    renderer: { id: "studio.react-preview", type: "sandboxed-web", status: "ready" },
  });
  expect(failures).toEqual([]);
});

test("runs explicit AgentReact end to end and commits only a verified staging build", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const failures = watchFailures(page);
  await page.addInitScript(() => {
    globalThis.__agentReactObservations = [];
    addEventListener("harness.artifact-observation", (event) => globalThis.__agentReactObservations.push(event.detail));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArtifacts(page);
  await page.getByRole("button", { name: /orders\.agent\.canvas\.tsx/ }).click();

  const liveFrame = page.locator('iframe[title="Live AgentReact preview: orders.agent.canvas.tsx"]');
  const live = page.frameLocator('iframe[title="Live AgentReact preview: orders.agent.canvas.tsx"]');
  await expect(live.locator("h1")).toHaveText("Orders AgentReact", { timeout: 15_000 });
  await expect(live.locator("[data-agent-react-label]")).toHaveText("first verified build");
  await expect(live.locator("[data-artifact-node]").first()).toBeVisible();
  await expect(page.getByText("AgentReact build committed from isolated staging.")).toBeVisible();
  await expect(liveFrame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(liveFrame).toHaveAttribute("referrerpolicy", "no-referrer");
  const previewUri = await liveFrame.getAttribute("src");
  const previewResponse = await page.request.get(`${studio.url}${previewUri}`);
  expect(previewResponse.headers()["cache-control"]).toBe("private, max-age=31536000, immutable");
  expect(previewResponse.headers()["content-security-policy"]).toContain("default-src 'none'");
  expect(previewResponse.headers()["content-security-policy"]).toContain("connect-src 'none'");

  const catalog = await (await page.request.get(`${studio.url}/api/artifacts`)).json();
  expect(catalog.artifacts.find((artifact) => artifact.label === "orders.agent.canvas.tsx")).toMatchObject({
    format: "agent-react-tsx",
    renderer: { id: "studio.agent-react-preview", type: "sandboxed-web", status: "ready" },
    capabilities: expect.arrayContaining(["actions", "execute", "live-update", "state"]),
  });

  const direct = await page.context().newPage();
  await direct.goto(`${studio.url}${previewUri}`);
  await expect(direct.getByRole("heading", { name: "Orders AgentReact" })).toHaveCount(0);
  await direct.close();

  await live.getByRole("button", { name: "Add order" }).click();
  await expect(live.getByLabel("Order count")).toHaveText("1");
  const firstBuildUri = await liveFrame.getAttribute("src");

  try {
    await writeFile(join(artifactDirectory, "orders.agent.canvas.tsx"), agentReactSource("must not commit", "staging exploded"), "utf8");
    await expect(page.locator(".artifact-runtime-status")).toContainText("staging exploded", { timeout: 15_000 });
    await expect(page.locator(".artifact-runtime-status")).toContainText("Current remains on the last verified build.");
    await expect(live.locator("[data-agent-react-label]")).toHaveText("first verified build");
    await expect(live.getByLabel("Order count")).toHaveText("1");
    await expect(liveFrame).toHaveAttribute("src", firstBuildUri);

    await writeFile(join(artifactDirectory, "orders.agent.canvas.tsx"), agentReactSource("second verified build"), "utf8");
    await expect(live.locator("[data-agent-react-label]")).toHaveText("second verified build", { timeout: 15_000 });
    await expect(live.getByLabel("Order count")).toHaveText("1");
    await expect(liveFrame).not.toHaveAttribute("src", firstBuildUri);
    await expect(page.getByText("AgentReact build committed from isolated staging.")).toBeVisible();

    await writeFile(join(artifactDirectory, "orders.agent.canvas.tsx"), agentReactSource("interactive failure build", undefined, "current exploded"), "utf8");
    await expect(live.locator("[data-agent-react-label]")).toHaveText("interactive failure build", { timeout: 15_000 });
    await live.getByRole("button", { name: "Break current" }).click();
    await expect(page.locator(".artifact-runtime-status")).toContainText("current exploded");
    await expect(page.getByRole("tab", { name: "Source", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(liveFrame).toHaveCount(0);

    await writeFile(join(artifactDirectory, "orders.agent.canvas.tsx"), agentReactSource("recovered current build"), "utf8");
    await expect(page.getByText("AgentReact build committed from isolated staging.")).toBeVisible({ timeout: 15_000 });
    await page.locator(".artifact-runtime-tabs").getByRole("tab", { name: "Preview", exact: true }).click();
    await expect(live.locator("[data-agent-react-label]")).toHaveText("recovered current build");
    await expect(live.getByLabel("Order count")).toHaveText("1");

    const observations = await page.evaluate(() => globalThis.__agentReactObservations);
    expect(observations.length).toBeGreaterThanOrEqual(5);
    expect(observations.map((entry) => entry?.value?.kind)).toEqual(expect.arrayContaining([
      "renderCompleted",
      "renderFailed",
    ]));
    expect(observations.every((entry, index) => entry.type === "CUSTOM"
      && entry.name === "harness.artifact-observation"
      && entry.value.sequence === index + 1
      && typeof entry.value.artifactDigest === "string"
      && typeof entry.value.buildDigest === "string")).toBe(true);

    await live.getByRole("button", { name: "Show source" }).click();
    await expect(page.getByRole("tab", { name: "Source", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-artifact-code-view="source"]')).toContainText("recovered current build");
    await page.screenshot({ path: testInfo.outputPath("agent-react-source-action.png"), fullPage: true });
  } finally {
    await writeFile(join(artifactDirectory, "orders.agent.canvas.tsx"), agentReactSource("first verified build"), "utf8");
  }
  expect(failures).toEqual(["current exploded"]);
});

test("keeps the current AgentReact session across unrelated artifact invalidations", async ({ page }) => {
  const failures = watchFailures(page);
  await openArtifacts(page);
  await page.getByRole("button", { name: /orders\.agent\.canvas\.tsx/ }).click();

  const live = page.frameLocator('iframe[title="Live AgentReact preview: orders.agent.canvas.tsx"]');
  const status = page.locator(".artifact-runtime-status");
  await expect(live.getByRole("heading", { name: "Orders AgentReact" })).toBeVisible({ timeout: 15_000 });
  await expect(status).toContainText("AgentReact build committed from isolated staging.");
  await live.getByRole("button", { name: "Add order" }).click();
  await expect(live.getByLabel("Order count")).toHaveText("1");

  const catalog = await (await page.request.get(`${studio.url}/api/artifacts`)).json();
  const snapshotUri = catalog.artifacts.find((artifact) => artifact.label === "orders.agent.canvas.tsx")?.build?.snapshotUri;
  expect(snapshotUri).toBeTruthy();
  try {
    for (const text of ["unrelated invalidation one\n", "unrelated invalidation two\n"]) {
      const refreshed = page.waitForResponse((response) => response.request().method() === "GET"
        && new URL(response.url()).pathname === snapshotUri);
      await writeFile(join(artifactDirectory, "notes.txt"), text, "utf8");
      await refreshed;
      await expect(status).toContainText("AgentReact build committed from isolated staging.");
      await expect(live.getByLabel("Order count")).toHaveText("1");
    }

    await live.getByRole("button", { name: "Add order" }).click();
    await expect(live.getByLabel("Order count")).toHaveText("2");
    await live.getByRole("button", { name: "Show source" }).click();
    await expect(page.getByRole("tab", { name: "Source", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.locator(".artifact-runtime-tabs").getByRole("tab", { name: "Preview", exact: true }).click();
    await expect(live.getByLabel("Order count")).toHaveText("2");
  } finally {
    await writeFile(join(artifactDirectory, "notes.txt"), "followed the declared content reference\n", "utf8");
  }
  expect(failures).toEqual([]);
});

test("keeps AgentReact Preview primary at wide, compact, and narrow widths", async ({ page }, testInfo) => {
  const failures = watchFailures(page);
  for (const layout of [
    { name: "wide", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "narrow", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await openArtifacts(page);
    await page.getByRole("button", { name: /orders\.agent\.canvas\.tsx/ }).click();
    const live = page.frameLocator('iframe[title="Live AgentReact preview: orders.agent.canvas.tsx"]');
    await expect(live.getByRole("heading", { name: "Orders AgentReact" })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".artifact-runtime-tabs").getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), `${layout.name} AgentReact preview overflows horizontally`).toBe(false);
    await page.locator(".artifact-runtime-tabs").getByRole("tab", { name: "Source" }).focus();
    expect(Number.parseFloat(await page.locator(".artifact-runtime-tabs").getByRole("tab", { name: "Source" }).evaluate((element) => getComputedStyle(element).outlineWidth))).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath(`agent-react-${layout.name}.png`), fullPage: true });
  }
  expect(failures).toEqual([]);
});

test("commits AgentReact when preview paint callbacks are suspended", async ({ page }) => {
  const failures = watchFailures(page);
  await page.addInitScript(() => {
    if (location.pathname.includes("/api/artifacts/") && location.pathname.endsWith("/preview")) {
      globalThis.requestAnimationFrame = () => 1;
    }
  });
  await openArtifacts(page);
  await page.getByRole("button", { name: /orders\.agent\.canvas\.tsx/ }).click();

  const live = page.frameLocator('iframe[title="Live AgentReact preview: orders.agent.canvas.tsx"]');
  await expect(live.getByRole("heading", { name: "Orders AgentReact" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("AgentReact build committed from isolated staging.")).toBeVisible();
  expect(failures).toEqual([]);
});

test("reports code Artifact compile diagnostics without executing a partial build", async ({ page }) => {
  const failures = watchFailures(page);
  await openArtifacts(page);
  await page.getByRole("button", { name: /broken\.canvas\.tsx/ }).click();
  await expect(page.getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".artifact-code-preview")).toContainText("<main>broken");
  await expect(page.locator(".artifact-code-preview [data-highlight-state=\"highlighted\"]")).toBeVisible();
  await expect(page.locator(".artifact-runtime-status")).toContainText("closing \"main\" tag");
  await expect(page.locator(".artifact-runtime-status").getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.locator('iframe[title="Live artifact preview: broken.canvas.tsx"]')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test("reports a runtime failure instead of claiming a completed render", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArtifacts(page);

  // A component that throws while rendering commits nothing. React reports the
  // error out of band, so a host that only watched the mount call would show a
  // ready status over an empty frame.
  await page.getByRole("button", { name: /throws\.canvas\.tsx/ }).click();
  const status = page.locator(".artifact-runtime-status");
  await expect(status).toContainText("render exploded");
  await expect(status).toHaveClass(/state-runtime-failed/);
  await expect(page.getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".artifact-code-preview")).toContainText("render exploded");

  // A preview can also break after it mounts, and the host has to leave the
  // ready state it already committed.
  await page.getByRole("button", { name: /late-throw\.canvas\.tsx/ }).click();
  await expect(status).toContainText("late boom");
  await expect(status).toHaveClass(/state-runtime-failed/);
  await expect(page.getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
  await expect(status.getByRole("button", { name: "Retry" })).toBeVisible();

  // Recovering must not need a page reload.
  await page.getByRole("button", { name: /component\.canvas\.tsx/ }).click();
  await expect(page.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.frameLocator('iframe[title="Live artifact preview: component.canvas.tsx"]').locator('[data-preview="current"]')).toHaveText("first render");
  await expect(page.getByText("Preview rendered from the current build.")).toBeVisible();
});

test("moves between Preview and Source with arrow keys from one tab stop", async ({ page }) => {
  const failures = watchFailures(page);
  await openArtifacts(page);
  await page.getByRole("button", { name: /component\.canvas\.tsx/ }).click();
  const tabs = page.locator(".artifact-runtime-tabs");
  await expect(page.locator(`#${ARTIFACT_PREVIEW_PANEL_ID}`)).toHaveAttribute("role", "tabpanel");
  await expect(tabs.locator("span")).toHaveCount(0);
  await tabs.getByRole("tab", { name: "Preview" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Source" })).toBeFocused();
  await expect(tabs.getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".artifact-code-preview")).toContainText("data-preview");
  await page.keyboard.press("Home");
  await expect(tabs.getByRole("tab", { name: "Preview" })).toBeFocused();
  expect(failures).toEqual([]);
});

test("commits a changed TSX build without reloading Studio and retains the selected Host tab", async ({ page }, testInfo) => {
  const failures = watchFailures(page);
  await openArtifacts(page);
  await page.getByRole("button", { name: /component\.canvas\.tsx/ }).click();
  const frame = page.locator('iframe[title="Live artifact preview: component.canvas.tsx"]');
  const preview = page.frameLocator('iframe[title="Live artifact preview: component.canvas.tsx"]');
  await expect(preview.locator('[data-preview="current"]')).toHaveText("first render");
  const firstBuild = await frame.getAttribute("src");
  const sourceTab = page.getByRole("tab", { name: "Source", exact: true });
  try {
    await sourceTab.click();
    await expect(sourceTab).toHaveAttribute("aria-selected", "true");
    await writeFile(join(artifactDirectory, "component.canvas.tsx"), 'document.body.dataset.moduleEvaluated = "yes"; export default () => <p data-preview="current">second render</p>;\n', "utf8");
    await expect(sourceTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".artifact-code-preview")).toContainText("second render", { timeout: 10_000 });
    await page.locator(".artifact-runtime-tabs").getByRole("tab", { name: "Preview", exact: true }).click();
    await expect(preview.locator('[data-preview="current"]')).toHaveText("second render", { timeout: 10_000 });
    await expect(frame).not.toHaveAttribute("src", firstBuild);
    await page.screenshot({ path: testInfo.outputPath("artifact-retained-host-tab.png"), fullPage: true });
  } finally {
    await writeFile(join(artifactDirectory, "component.canvas.tsx"), 'document.body.dataset.moduleEvaluated = "yes"; export default () => <p data-preview="current">first render</p>;\n', "utf8");
  }
  expect(failures).toEqual([]);
});

test("loads artifact bytes from the catalog content reference", async ({ page }) => {
  // Point one descriptor at a different artifact's revision-scoped URL. The
  // client must fetch what the catalog declared rather than rebuilding an
  // address from the id it happens to hold.
  await page.route("**/api/artifacts", async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    const component = catalog.artifacts.find((entry) => entry.label === "component.canvas.tsx");
    const other = catalog.artifacts.find((entry) => entry.label === "notes.txt");
    component.revision.content.uri = other.revision.content.uri;
    await route.fulfill({ response, json: catalog });
  });
  await openArtifacts(page);
  await page.getByRole("button", { name: /component\.canvas\.tsx/ }).click();
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await expect(page.locator(".artifact-code-preview")).toContainText("followed the declared content reference");
  await expect(page.locator(".artifact-code-preview")).not.toContainText("data-preview");
});

test("rejects a late exact-content response from an older revision", async ({ page }) => {
  const failures = watchFailures(page);
  await openArtifacts(page);
  const catalog = await (await page.request.get(`${studio.url}/api/artifacts`)).json();
  const notes = catalog.artifacts.find((entry) => entry.label === "notes.txt");
  expect(notes).toBeDefined();
  await page.getByRole("button", { name: /notes\.txt/ }).click();
  await expect(page.locator(".artifact-code-preview")).toContainText("followed the declared content reference");
  await page.evaluate((artifactId) => {
    const originalFetch = window.fetch.bind(window);
    window.__releaseDelayedArtifactContent = undefined;
    window.__delayedArtifactContentStarted = false;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      if (url.includes(`/api/artifacts/${artifactId}/revisions/`) && url.endsWith("/content")) {
        const text = await response.clone().text();
        if (text.includes("delayed older revision")) {
          window.__delayedArtifactContentStarted = true;
          await new Promise((resolveRelease) => {
            window.__releaseDelayedArtifactContent = resolveRelease;
          });
        }
      }
      return response;
    };
  }, notes.id);

  try {
    await writeFile(join(artifactDirectory, "notes.txt"), "delayed older revision\n", "utf8");
    await expect.poll(() => page.evaluate(() => window.__delayedArtifactContentStarted)).toBe(true);
    await writeFile(join(artifactDirectory, "notes.txt"), "latest exact revision\n", "utf8");
    await expect(page.locator(".artifact-code-preview")).toContainText("latest exact revision", { timeout: 10_000 });
    await page.evaluate(() => window.__releaseDelayedArtifactContent?.());
    await page.waitForTimeout(200);
    await expect(page.locator(".artifact-code-preview")).toContainText("latest exact revision");
    await expect(page.locator(".artifact-code-preview")).not.toContainText("delayed older revision");
  } finally {
    await page.evaluate(() => window.__releaseDelayedArtifactContent?.());
    await writeFile(join(artifactDirectory, "notes.txt"), "followed the declared content reference\n", "utf8");
  }
  expect(failures).toEqual([]);
});

test("renders diff, SVG, and Beautiful Mermaid through the shared sandbox", async ({ page }, testInfo) => {
  const failures = watchFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArtifacts(page);
  await page.getByRole("button", { name: /change\.patch/ }).click();
  const diff = page.locator('[data-artifact-code-view="diff"] [data-code-diff="pierre"]');
  await expect(diff).toHaveAttribute("data-file-count", "2");
  await expect(diff).toHaveAttribute("data-render-state", "ready");
  await expect(diff).toContainText("guide.md");
  await expect(diff).toContainText("Second file remains visible.");
  await page.screenshot({ path: testInfo.outputPath("artifact-multi-file-diff.png"), fullPage: true });
  await page.getByRole("button", { name: /diagram\.svg/ }).click();
  const frame = page.locator('iframe[title="Live artifact preview: diagram.svg"]');
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(page.frameLocator('iframe[title="Live artifact preview: diagram.svg"]').getByRole("img", { name: "SVG artifact" })).toBeVisible();
  const catalog = await (await page.request.get(`${studio.url}/api/artifacts`)).json();
  const svg = catalog.artifacts.find((entry) => entry.label === "diagram.svg");
  expect(svg).toMatchObject({ backing: "code", renderer: { id: "studio.svg-react-preview", type: "sandboxed-web" } });
  const raw = await page.request.get(`${studio.url}${svg.revision.content.uri}`);
  expect(raw.headers()["content-type"]).toBe("image/svg+xml");
  expect(raw.headers()["content-disposition"]).toMatch(/^attachment;/u);
  expect(raw.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");
  await expect(page.locator("body")).not.toHaveAttribute("data-svg-executed", "yes");

  await page.getByRole("button", { name: /diagram\.mmd/ }).click();
  const mermaidFrame = page.frameLocator('iframe[title="Live artifact preview: diagram.mmd"]');
  const diagram = mermaidFrame.getByRole("img", { name: "Mermaid diagram" });
  await expect(diagram).toBeVisible();
  expect(await diagram.evaluate((image) => ({ width: image.naturalWidth, height: image.naturalHeight })))
    .toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
  expect(await diagram.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText("Preview rendered from the current build.")).toBeVisible();
  for (const layout of [
    { name: "wide", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "narrow", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await expect(diagram).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${layout.name} Mermaid preview overflows horizontally`).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`beautiful-mermaid-${layout.name}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const mermaidFrameElement = page.locator('iframe[title="Live artifact preview: diagram.mmd"]');
  const firstMermaidBuild = await mermaidFrameElement.getAttribute("src");
  try {
    await writeFile(join(artifactDirectory, "diagram.mmd"), "graph LR\n  Updated --> Diagram\n", "utf8");
    await expect(mermaidFrameElement).not.toHaveAttribute("src", firstMermaidBuild, { timeout: 10_000 });
    await expect(mermaidFrame.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
    await expect(page.getByText("Preview rendered from the current build.")).toBeVisible();
    // Exercise the failing build before restoring diagram.mmd. Restoring emits
    // an advisory catalog invalidation; racing that unrelated rebuild with the
    // next click would only test scheduler timing, not the invalid fixture.
    await page.getByRole("button", { name: /invalid\.mmd/ }).click();
    await expect(page.getByText(/Invalid mermaid header/u)).toBeVisible();
    await expect(page.getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".artifact-code-preview [data-highlight-state=\"highlighted\"]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  } finally {
    await writeFile(join(artifactDirectory, "diagram.mmd"), "---\ntitle: Fixture diagram\n---\ngraph TD\n  Start --> Finish\n", "utf8");
  }
  expect(failures).toEqual([]);
});

test("renders Markdown as elements and refuses to execute what it carries", async ({ page }, testInfo) => {
  const failures = watchFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArtifacts(page);
  await page.getByRole("button", { name: /report\.md/ }).click();

  const document = page.locator(".markdown-document");
  await expect(document.getByRole("heading", { name: "Run report", level: 1 })).toBeVisible();
  await expect(document.locator("strong")).toHaveText("bold");
  await expect(document.locator(".markdown-inline-code")).toHaveText("code");
  await expect(document.locator("table td").first()).toHaveText("parse");
  await expect(document.locator(".markdown-table-scroll th").nth(1)).toHaveCSS("text-align", "right");
  await expect(document.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(document.locator('input[type="checkbox"]').first()).toBeChecked();
  await expect(document.locator('input[type="checkbox"]').first()).toBeDisabled();

  // Fenced code reaches the shared highlighter rather than a bare <pre>.
  await expect(document.locator('.markdown-code-block[data-md-language="ts"] [data-highlight-state="highlighted"]')).toBeVisible();

  // A local image is served from the snapshot's own revision-scoped resource.
  const image = document.locator("img.markdown-image");
  await expect(image).toHaveAttribute("src", /\/api\/artifacts\/[^/]+\/revisions\/[0-9a-f]{64}\/resources\/media-/u);
  await expect(image).toHaveJSProperty("complete", true);

  // Markup inside the document is text, and it never ran.
  await expect(document.locator("[data-md-raw-html]")).toContainText("onerror");
  await expect(page.locator("body")).not.toHaveAttribute("data-markdown-executed", "yes");
  await expect(document.locator("img[src='x']")).toHaveCount(0);

  // Only a followable scheme becomes an anchor; the rest survives as its label.
  const link = document.getByRole("link", { name: "safe link" });
  await expect(link).toHaveAttribute("href", "https://example.com/page");
  await expect(link).toHaveAttribute("rel", "noreferrer noopener");
  await expect(document.getByRole("link", { name: "blocked link" })).toHaveCount(0);
  await expect(document).toContainText("blocked link");

  // The outline navigates the document without touching Studio's hash route.
  const outline = page.locator(".markdown-outline-rail");
  await expect(outline.getByRole("button", { name: "Deep detail" })).toBeVisible();
  await outline.getByRole("button", { name: "Deep detail" }).click();
  await expect(document.locator('[data-md-heading="deep-detail"]')).toBeInViewport();
  expect(new URL(page.url()).hash).toBe("#/artifacts");
  await document.getByRole("button", { name: "Findings" }).click();
  await expect(document.locator('[data-md-heading="findings"]')).toBeInViewport();
  expect(new URL(page.url()).hash).toBe("#/artifacts");

  await expect(page.locator(".artifact-editor-header")).toContainText("studio.markdown-commonmark");
  await page.screenshot({ path: testInfo.outputPath("artifact-markdown-wide.png"), fullPage: true });
  expect(failures).toEqual([]);
});

test("keeps the Markdown document readable at compact and narrow widths", async ({ page }, testInfo) => {
  const failures = watchFailures(page);
  for (const layout of [{ name: "compact", width: 1024, height: 768 }, { name: "narrow", width: 390, height: 844 }]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await openArtifacts(page);
    await page.getByRole("button", { name: /report\.md/ }).click();
    await expect(page.locator(".markdown-document").getByRole("heading", { name: "Run report" })).toBeVisible();
    // The outline rail is the first thing to go; the document itself never is.
    await expect(page.locator(".markdown-outline-rail")).toBeVisible({ visible: layout.width > 760 });
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows, `${layout.name} markdown overflows horizontally`).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`artifact-markdown-${layout.name}.png`), fullPage: true });
  }
  expect(failures).toEqual([]);
});

test("renders a PPTX snapshot through Studio without a provisioned Qoder Canvas runtime", async ({ page }) => {
  const failures = watchFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArtifacts(page);
  await page.getByRole("button", { name: /deck\.pptx/ }).click();
  await expect(page.locator(".pptx-artifact-viewer")).toBeVisible();
  await expect(page.locator(".pptx-slide-shape")).toContainText("01");
  await expect(page.locator(".pptx-slide-image")).toHaveCount(1);
  await expect(page.locator(".pptx-slide-image")).toHaveJSProperty("complete", true);
  await expect(page.locator(".artifact-editor-header")).toContainText("studio.pptx-ooxml");
  await expect(page.locator(".artifact-preview-pane iframe")).toHaveCount(0);

  // The adapter's addressed outline and its diagnostics are both reachable, so
  // neither ships as payload that nothing reads.
  const outlineEntry = page.locator(".pptx-outline-pane button").first();
  await expect(outlineEntry).toBeVisible();
  await outlineEntry.click();
  await expect(page.locator(".pptx-slide-element.selected")).toHaveCount(1);
  await page.locator(".artifact-diagnostics > summary").click();
  await expect(page.locator(".artifact-diagnostics > ul")).toContainText("PPTX_BASELINE_RENDERER");
  expect(failures).toEqual([]);
});

test("retains PPTX zoom but resets revision-scoped selection", async ({ page }, testInfo) => {
  const failures = watchFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArtifacts(page);
  await page.getByRole("button", { name: /deck\.pptx/ }).click();
  const viewer = page.locator(".pptx-artifact-viewer");
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(viewer.locator(".document-zoom-controls output")).toHaveText("125%");
  await viewer.locator(".pptx-outline-pane button").first().click();
  await expect(viewer.locator(".pptx-slide-element.selected")).toHaveCount(1);
  try {
    await writeFile(join(artifactDirectory, "deck.pptx"), createPptxFixture("02"));
    await expect(viewer.locator(".pptx-slide-shape")).toContainText("02", { timeout: 10_000 });
    await expect(viewer.locator(".document-zoom-controls output")).toHaveText("125%");
    await expect(viewer.locator(".pptx-slide-element.selected")).toHaveCount(0);
    await expect(viewer.locator(".pptx-slide-rail button").first()).toHaveAttribute("aria-current", "true");
    await page.screenshot({ path: testInfo.outputPath("artifact-pptx-revision-state.png"), fullPage: true });
  } finally {
    await writeFile(join(artifactDirectory, "deck.pptx"), createPptxFixture("01"));
  }
  expect(failures).toEqual([]);
});

test("renders a read-only XLSX snapshot with sheets, formulas, merges, and styles", async ({ page }, testInfo) => {
  const failures = watchFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArtifacts(page);
  await page.getByRole("button", { name: /workbook\.xlsx/ }).click();
  const viewer = page.locator(".xlsx-artifact-viewer");
  await expect(viewer).toBeVisible();
  await expect(page.locator(".artifact-editor-header")).toContainText("studio.xlsx-ooxml");
  await expect(page.locator(".artifact-preview-pane iframe")).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Data" })).toHaveAttribute("aria-current", "true");
  await expect(viewer.getByRole("gridcell", { name: "A2 2026-08-23" })).toBeVisible();
  await expect(viewer.getByRole("gridcell", { name: "C2 Canvas TSX" })).toBeVisible();

  await viewer.getByRole("button", { name: "Summary" }).click();
  const title = viewer.getByRole("gridcell", { name: "A1 Studio XLSX Fixture" });
  await expect(title).toBeVisible();
  expect(await title.evaluate((element) => element.colSpan)).toBe(2);
  expect(await title.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(23, 50, 77)");
  await title.focus();
  await expect(title).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(viewer.getByRole("gridcell", { name: "A2" })).toBeFocused();
  await expect(viewer.locator(".xlsx-formula-bar")).toContainText("A2");
  const formulaCell = viewer.getByRole("gridcell", { name: "B3 30" });
  await formulaCell.click();
  await expect(viewer.locator(".xlsx-formula-bar")).toContainText("=SUM('Data'!B2:B3)");
  await expect(viewer.getByRole("gridcell", { name: "B4 75.0%" })).toBeVisible();
  await viewer.locator(".artifact-diagnostics > summary").click();
  await expect(viewer.locator(".artifact-diagnostics > ul")).toContainText("XLSX_BASELINE_RENDERER");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("artifact-xlsx-wide.png"), fullPage: true });
  expect(failures).toEqual([]);
});

test("virtualizes wide XLSX columns and keeps the far edge selectable", async ({ page }) => {
  const failures = watchFailures(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  try {
    await writeFile(join(artifactDirectory, "workbook.xlsx"), createXlsxFixture({ farColumn: 256 }));
    await openArtifacts(page);
    await page.getByRole("button", { name: /workbook\.xlsx/ }).click();
    const viewer = page.locator(".xlsx-artifact-viewer");
    await viewer.getByRole("button", { name: "Summary" }).click();
    await expect(viewer.locator(".xlsx-column-spacer").first()).toBeVisible();
    expect(await viewer.getByRole("gridcell").count()).toBeLessThan(100);
    await viewer.locator(".xlsx-grid-scroll").evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.dispatchEvent(new Event("scroll"));
    });
    const farCell = viewer.locator('[data-address="IV4"]');
    await expect(farCell).toBeVisible();
    await farCell.click();
    await expect(viewer.locator(".xlsx-formula-bar strong")).toHaveText("IV4");
  } finally {
    await writeFile(join(artifactDirectory, "workbook.xlsx"), createXlsxFixture());
  }
  expect(failures).toEqual([]);
});

test("resets XLSX sheet and cell state to the new snapshot default", async ({ page }, testInfo) => {
  const failures = watchFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArtifacts(page);
  await page.getByRole("button", { name: /workbook\.xlsx/ }).click();
  const viewer = page.locator(".xlsx-artifact-viewer");
  await viewer.getByRole("button", { name: "Summary" }).click();
  await viewer.getByRole("gridcell", { name: "B3 30" }).click();
  await expect(viewer.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(1);
  try {
    await writeFile(join(artifactDirectory, "workbook.xlsx"), createXlsxFixture({ formulaResult: 31 }));
    await expect(viewer.getByRole("button", { name: "Data" })).toHaveAttribute("aria-current", "true", { timeout: 10_000 });
    await expect(viewer.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(0);
    await expect(viewer.locator(".xlsx-formula-bar strong")).toHaveText("Data");
    await page.screenshot({ path: testInfo.outputPath("artifact-xlsx-revision-state.png"), fullPage: true });
  } finally {
    await writeFile(join(artifactDirectory, "workbook.xlsx"), createXlsxFixture());
  }
  expect(failures).toEqual([]);
});

test("renders a read-only DOCX snapshot at wide, compact, and narrow widths", async ({ page }, testInfo) => {
  const failures = watchFailures(page);
  for (const layout of [
    { name: "wide", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "narrow", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await openArtifacts(page);
    await page.getByRole("button", { name: /document\.docx/ }).click();
    const viewer = page.locator(".docx-artifact-viewer");
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole("heading", { name: /Studio Word Fixture/u })).toBeVisible();
    await expect(viewer).toContainText("Cell A");
    const image = viewer.locator(".docx-inline-image");
    await expect(image).toHaveJSProperty("complete", true);
    await expect(page.locator(".artifact-editor-header")).toContainText("studio.docx-ooxml");
    await expect(page.locator(".artifact-preview-pane iframe")).toHaveCount(0);
    await expect(page.getByText(/Read-only/u)).toBeVisible();
    await expect(page.locator(".docx-outline-pane")).toBeVisible({ visible: layout.width > 760 });
    if (layout.width <= 760) {
      const pageBox = await viewer.locator(".docx-document-page").boundingBox();
      const scrollBox = await viewer.locator(".docx-document-scroll").boundingBox();
      expect(pageBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((scrollBox?.width ?? 0) + 1);
      expect(await viewer.locator(".docx-document-scroll").evaluate((element) => element.scrollLeft)).toBe(0);
    }
    const cellText = viewer.getByText("Cell A", { exact: true });
    expect(await cellText.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(0, 0, 0)");
    await cellText.hover();
    expect(await viewer.locator(".docx-table-scroll tr").first().evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe("rgba(0, 0, 0, 0)");
    await cellText.click();
    await expect(viewer.locator(".docx-table-scroll .docx-paragraph.selected")).toContainText("Cell A");
    await expect(viewer.locator(".docx-table-scroll.selected")).toHaveCount(0);
    if (layout.name === "wide") {
      const before = await image.boundingBox();
      await viewer.getByRole("button", { name: "Zoom in" }).click();
      await expect(viewer.locator(".document-zoom-controls output")).toHaveText("125%");
      const after = await image.boundingBox();
      expect((after?.width ?? 0) / (before?.width ?? 1)).toBeCloseTo(1.25, 1);
      await viewer.getByRole("button", { name: "Zoom out" }).click();
      await expect(viewer.locator(".document-zoom-controls output")).toHaveText("100%");
    }
    if (layout.width > 760) {
      await page.locator(".docx-outline-pane button").first().click();
      await expect(page.locator(".docx-paragraph.selected")).toHaveCount(1);
    }
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows, `${layout.name} DOCX overflows horizontally`).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`artifact-docx-${layout.name}.png`), fullPage: true });
  }
  await page.locator(".artifact-diagnostics > summary").click();
  await expect(page.locator(".artifact-diagnostics > ul")).toContainText("DOCX_BASELINE_RENDERER");
  expect(failures).toEqual([]);
});

test("retains DOCX zoom but clears revision-scoped selection", async ({ page }, testInfo) => {
  const failures = watchFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArtifacts(page);
  await page.getByRole("button", { name: /document\.docx/ }).click();
  const viewer = page.locator(".docx-artifact-viewer");
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(viewer.locator(".document-zoom-controls output")).toHaveText("125%");
  await viewer.locator(".docx-outline-pane button").first().click();
  await expect(viewer.locator(".docx-paragraph.selected")).toHaveCount(1);
  try {
    await writeFile(join(artifactDirectory, "document.docx"), createDocxFixture("Updated Word Fixture"));
    await expect(viewer.getByRole("heading", { name: /Updated Word Fixture/u })).toBeVisible({ timeout: 10_000 });
    await expect(viewer.locator(".document-zoom-controls output")).toHaveText("125%");
    await expect(viewer.locator(".docx-paragraph.selected")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("artifact-docx-revision-state.png"), fullPage: true });
  } finally {
    await writeFile(join(artifactDirectory, "document.docx"), createDocxFixture("Studio Word Fixture"));
  }
  expect(failures).toEqual([]);
});

test("keeps the artifact workbench usable at wide, compact, and narrow widths", async ({ page }) => {
  for (const layout of [
    { name: "wide", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "narrow", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await openArtifacts(page);
    if (layout.width <= 1080) await expect(page.locator(".studio-primary-nav")).not.toBeInViewport();
    await page.getByRole("button", { name: /deck\.pptx/ }).click();
    if (layout.width <= 640) await expect(page.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".pptx-artifact-viewer")).toBeVisible();
    await expect(page.locator(".pptx-slide-shape")).toContainText("01");
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows, `${layout.name} overflows horizontally`).toBe(false);
    await page.screenshot({ path: `test-results/artifacts-${layout.name}.png`, fullPage: true });
  }
});

test("keeps live Artifact Preview primary at wide, compact, and narrow widths", async ({ page }) => {
  for (const layout of [
    { name: "wide", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "narrow", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await openArtifacts(page);
    await page.getByRole("button", { name: /component\.canvas\.tsx/ }).click();
    await expect(page.frameLocator('iframe[title="Live artifact preview: component.canvas.tsx"]').locator('[data-preview="current"]')).toHaveText("first render");
    await expect(page.getByText("Preview rendered from the current build.")).toBeVisible();
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows, `${layout.name} live preview overflows horizontally`).toBe(false);
    await page.locator(".artifact-runtime-tabs").getByRole("tab", { name: "Source" }).focus();
    expect(Number.parseFloat(await page.locator(".artifact-runtime-tabs").getByRole("tab", { name: "Source" }).evaluate((element) => getComputedStyle(element).outlineWidth))).toBeGreaterThan(0);
    await page.screenshot({ path: `test-results/artifacts-live-${layout.name}.png`, fullPage: true });
  }
});

test("gives artifact rows a visible keyboard focus ring", async ({ page }) => {
  await openArtifacts(page);
  const row = page.getByRole("button", { name: /component\.canvas\.tsx/ });
  await row.focus();
  expect(Number.parseFloat(await row.evaluate((element) => getComputedStyle(element).outlineWidth))).toBeGreaterThan(0);
});

test("persists the explicit Studio theme and keeps core contrast accessible", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(studio.url);
  const contrast = async () => page.evaluate(() => {
    const parse = (value) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    const luminance = (value) => parse(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = (foreground, background) => {
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    };
    const body = getComputedStyle(document.body);
    const primary = getComputedStyle(document.querySelector("button.primary"));
    return {
      body: ratio(body.color, body.backgroundColor),
      primary: ratio(primary.color, primary.backgroundColor),
    };
  });

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const darkContrast = await contrast();
  expect(darkContrast.body).toBeGreaterThanOrEqual(4.5);
  expect(darkContrast.primary).toBeGreaterThanOrEqual(4.5);
  await page.getByRole("button", { name: /Dark theme active/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const lightContrast = await contrast();
  expect(lightContrast.body).toBeGreaterThanOrEqual(4.5);
  expect(lightContrast.primary).toBeGreaterThanOrEqual(4.5);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /Light theme active/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});

test("opens a project workspace and compares Inspector-discovered Sessions", async ({ page }) => {
  const failures = watchFailures(page);
  const requestedUrls = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  await page.goto(emptyStudio.url);
  const gate = page.getByRole("dialog", { name: "Open a Project to start" });
  await expect(gate).toBeVisible();
  await expect(page.locator(".studio-control-plane")).toHaveAttribute("inert", "");
  await expect(page.locator(".studio-control-plane")).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByRole("button", { name: "Choose Project" })).toBeVisible();

  for (const layout of [
    { name: "wide", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "narrow", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    if (layout.width <= 1080) await expect(page.locator(".studio-primary-nav")).not.toBeInViewport();
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows, `${layout.name} workspace gate overflows horizontally`).toBe(false);
    await page.screenshot({ path: `test-results/session-workspace-gate-${layout.name}.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Choose Project" }).click();
  await expect(page.getByRole("button", { name: "Opening Project" })).toBeDisabled();
  await expect(page.locator(".workspace-open-progress")).toContainText("Finding matching Project Sessions across local providers");
  await expect(page.locator(".workspace-open-progress > i")).toHaveCSS("animation-name", "workspace-progress-spin");
  await page.screenshot({ path: "test-results/session-workspace-loading-wide.png", fullPage: true });

  await expect(gate).toHaveCount(0);
  await expect(page.locator(".studio-control-plane")).not.toHaveAttribute("inert", "");
  await expect(page).toHaveURL(/#\/projects\/project_[a-f0-9]{32}\/overview$/u);
  await page.getByRole("navigation", { name: "Studio project and View navigation" }).getByRole("button", { name: /^Sessions/ }).click();
  await expect(page).toHaveURL(/#\/projects\/project_[a-f0-9]{32}\/sessions$/u);
  const inspector = page.locator("[data-studio-native-inspector]");
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveAttribute("data-react-inspector-workbench", "true");
  await expect(inspector.getByRole("tab", { name: "Date" })).toHaveAttribute("aria-selected", "true");
  await expect(inspector.getByRole("button", { name: "Open session" }).first()).toBeVisible();
  expect(requestedUrls.some((url) => url.endsWith("/assets/inspector-workbench.js"))).toBe(false);
  const openSessionButton = inspector.getByRole("button", { name: "Open session" }).first();
  await openSessionButton.click();
  await expect(inspector.locator(".session-view")).toBeVisible();
  await expect(inspector.getByRole("dialog")).toContainText(/Repair (parser|renderer)/);
  await expect(inspector.getByRole("button", { name: "Close" })).toBeFocused();
  await expect(inspector.locator("[data-harness-inspector]")).toHaveAttribute("inert", "");
  await expect(inspector.locator("[data-harness-inspector]")).toHaveAttribute("aria-hidden", "true");
  await expect(page).toHaveURL(/inspector-session=/u);
  await expect(inspector.locator(".session-cell[data-session-cell=run]")).toHaveCount(1);
  await expect(inspector.locator("details.session-process")).not.toHaveAttribute("open", "");
  await expect(inspector.getByRole("region", { name: "Turn 1 outcome" })).toContainText("Outcome");
  await inspector.getByRole("button", { name: "Expand process" }).click();
  await expect(inspector.locator("details.session-process")).toHaveAttribute("open", "");
  await inspector.locator("details.session-filter-disclosure > summary").click();
  await expect(inspector.getByRole("checkbox", { name: /Tool calls/u })).toBeChecked();
  await inspector.getByRole("tab", { name: "Replay" }).click();
  await expect(inspector.getByRole("tab", { name: /Events/u })).toHaveAttribute("aria-selected", "true");
  await expect(inspector.getByRole("tab", { name: /Files/u })).toBeVisible();
  await inspector.getByRole("button", { name: /Next event/u }).click();
  await expect(inspector.locator(".replay-position")).toContainText("Event 2 /");
  await expect(page).toHaveURL(/inspector-event=/u);
  for (const layout of [
    { name: "wide", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "narrow", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    if (layout.width <= 1080) await expect(page.locator(".studio-primary-nav")).not.toBeInViewport();
    await expect(inspector.getByRole("button", { name: "Close" })).toBeVisible();
    await expect(inspector.locator(".replay-transport")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow, `${layout.name} Session detail overflows horizontally`).toBe(false);
    await page.screenshot({ path: `test-results/session-detail-replay-${layout.name}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press("Escape");
  await expect(inspector.locator(".session-view")).toHaveCount(0);
  await expect(inspector.locator("[data-harness-inspector]")).not.toHaveAttribute("inert", "");
  await expect(inspector.locator("[data-harness-inspector]")).not.toHaveAttribute("aria-hidden", "true");
  await expect(openSessionButton).toBeFocused();
  await expect(page).not.toHaveURL(/inspector-session=/u);
  for (const layout of [
    { name: "wide", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "narrow", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    if (layout.width <= 1080) await expect(page.locator(".studio-primary-nav")).not.toBeInViewport();
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows, `${layout.name} Inspector workbench overflows horizontally`).toBe(false);
    await page.screenshot({ path: `test-results/session-inspector-${layout.name}.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("tab", { name: "Catalog & Compare" }).click();
  await expect(page.getByRole("button", { name: /Repair renderer/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repair renderer" })).toBeVisible();
  await expect(page.locator(".session-event-rows")).toContainText("Bash");
  for (const layout of [
    { name: "wide", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "narrow", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    if (layout.width <= 1080) await expect(page.locator(".studio-primary-nav")).not.toBeInViewport();
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows, `${layout.name} session browser overflows horizontally`).toBe(false);
    await page.screenshot({ path: `test-results/session-browser-${layout.name}.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const sessionRows = page.locator(".session-catalog-rows > li > button");
  await expect(sessionRows).toHaveCount(2);
  await expect(page.locator('.session-catalog-rows > li > button[tabindex="0"]')).toHaveCount(1);
  await sessionRows.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(sessionRows.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(sessionRows.first()).toBeFocused();
  await expect(page.getByRole("checkbox", { name: /Select Repair parser .* for comparison/u })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Select Repair renderer .* for comparison/u })).toBeVisible();
  const compareChecks = page.locator(".session-catalog-rows input[type=checkbox]");
  await compareChecks.nth(0).check();
  await compareChecks.nth(1).check();
  await page.getByRole("button", { name: "Compare 2/2" }).click();
  await expect(page.getByRole("heading", { name: "Compare Sessions" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Metric" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Left" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Right" })).toBeVisible();
  await expect(page.locator(".session-compare-boundary")).toContainText("No winner inferred");
  await expect(page.locator(".session-compare-workspace")).toContainText("Repair parser");
  await expect(page.locator(".session-compare-workspace")).toContainText("Repair renderer");
  for (const layout of [
    { name: "wide", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "narrow", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    if (layout.width <= 1080) await expect(page.locator(".studio-primary-nav")).not.toBeInViewport();
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows, `${layout.name} session comparison overflows horizontally`).toBe(false);
    if (layout.name === "narrow") {
      const metricLayout = await page.evaluate(() => {
        const table = document.querySelector(".session-compare-table");
        const cells = [...document.querySelectorAll(".session-compare-table [role=cell]")];
        return {
          tableClient: table?.clientWidth ?? 0,
          tableScroll: table?.scrollWidth ?? Infinity,
          cells: cells.map((cell) => {
            const rect = cell.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
          }),
        };
      });
      expect(metricLayout.tableScroll).toBeLessThanOrEqual(metricLayout.tableClient + 1);
      expect(metricLayout.cells.every((cell) => cell.left >= 0 && cell.right <= layout.width + 1)).toBe(true);
    }
    await page.screenshot({ path: `test-results/session-compare-${layout.name}.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("navigation", { name: "Studio project and View navigation" }).getByRole("button", { name: /^Debugger/ }).click();
  await expect(page.getByText(/Project default · Qoder · fixture-project/u)).toBeVisible();
  await page.getByRole("button", { name: "New live run" }).click();
  await expect(page.getByRole("dialog", { name: "Start a live harness session" })).toContainText("Project fixture-project");
  await page.getByPlaceholder("Task prompt for the harness run…").fill("verify the default workspace harness");
  await page.getByRole("button", { name: "Run harness" }).click();
  await expect(page.locator(".session-notebook")).toContainText("default harness: verify the default workspace harness");
  await page.screenshot({ path: "test-results/default-workspace-debugger-wide.png", fullPage: true });

  const config = await page.evaluate(async () => await (await fetch("api/config")).json());
  expect(config).toMatchObject({ aguiEnabled: true, harnessMode: "workspace-default", workspaceConnected: true, workspaceWorkbenchEnabled: true, sessionCount: 2 });
  const workspace = await page.evaluate(async () => await (await fetch("api/workspace")).json());
  expect(workspace).toMatchObject({ connected: true, label: "fixture-project", providers: [{ provider: "qoder", status: "ok" }] });
  expect(JSON.stringify(workspace)).not.toContain(selectedWorkspace);
  expect(failures).toEqual([]);
});
