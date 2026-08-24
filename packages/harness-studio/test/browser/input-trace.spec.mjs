import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startHarnessStudioServer } from "../../dist/server/server.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let studio;
let workspace;

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "studio-input-trace-browser-"));
  studio = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    port: 0,
    workspaceDirectoryPicker: async () => workspace,
    workspaceSessionProvider: {
      discover: async () => ({
        label: "input-trace-fixture",
        sessions: [],
        inspectorReport: {
          kind: "HarnessInspectorReportV1",
          workspace: { name: "input-trace-fixture" },
          featureTree: { nodes: [], roots: [] },
          days: [],
          sessions: [{
            sessionId: "codex-session",
            platform: "codex",
            dialogue: {
              truncated: false,
              turns: [{
                index: 1,
                prompt: { text: "Inspect the design contract", timestamp: "2026-08-22T01:00:00.000Z" },
                steps: [{ kind: "tool", callId: "read-design", operation: "read-files", filePaths: ["DESIGN.md"] }],
              }, {
                index: 2,
                prompt: { text: "Implement the input server route", timestamp: "2026-08-22T02:00:00.000Z" },
                steps: [
                  { kind: "tool", callId: "read-server", operation: "read-files", filePaths: ["packages/harness-studio/src/server/server.ts"] },
                  { kind: "tool", callId: "edit-server", operation: "edit-files", filePaths: ["packages/harness-studio/src/server/server.ts"] },
                ],
              }, {
                index: 3,
                prompt: { text: "Explain the result", timestamp: "2026-08-22T03:00:00.000Z" },
                steps: [],
              }],
            },
          }],
        },
      }),
    },
    intentAnalyzer: {
      analyze: async (packet) => {
        const input = packet.inputs.find((candidate) => candidate.text === "Implement the input server route");
        const edge = packet.observedEdges.find((candidate) => candidate.subjectRef === input?.ref && candidate.predicate === "contains");
        return {
          kind: "IntentCorrelationAnalysisV1",
          schemaVersion: 1,
          packetDigest: packet.packetDigest,
          intentProposals: [{ id: "intent:proposed:input-server-route", title: "Implement the input server route", summary: "Expose retained inputs through Studio while keeping observed file links separate from AI interpretation.", sourceRefs: [input.ref], reviewStatus: "proposed" }],
          claims: [{
            id: "claim:input-creates-server-route-intent",
            subjectRef: input.ref,
            predicate: "creates",
            objectRef: "intent:proposed:input-server-route",
            evidenceRefs: [edge.ref],
            counterEvidenceRefs: [],
            alternatives: [],
            evidenceStrength: "direct",
            confidence: { semanticFit: "high", temporalFit: "high", changeFit: "low", acceptanceFit: "low" },
            reason: "The retained input directly names the route and begins its bounded execution slice.",
            limitations: ["The edit operation is only an edit target because no verified delta is retained."],
            reviewStatus: "proposed",
          }],
          unassignedRefs: packet.changeUnits.map(({ ref }) => ref),
          unresolved: [],
        };
      },
    },
  });
  const opened = await fetch(`${studio.url}/api/workspace/open`, { method: "POST" });
  if (!opened.ok) throw new Error(`Could not open input fixture: ${await opened.text()}`);
});

test.afterAll(async () => {
  await studio?.close();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

test("links retained user inputs and exact file operations across layouts", async ({ page }, testInfo) => {
  const failures = [];
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  page.on("pageerror", (error) => failures.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${studio.url}/#/inputs`);
  const rows = page.locator(".input-trace-rows > li");
  await expect(rows).toHaveCount(3);
  await page.getByRole("button", { name: "Analyze relationships" }).click();
  await expect(page.getByRole("region", { name: "Proposed Intent relationships" })).toBeVisible();
  await expect(page.getByText("AI claims · locally validated · not confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText("Implement the input server route", { exact: true })).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath("input-intent-analysis-wide.png"), fullPage: true });
  await page.getByRole("button", { name: "Close proposed Intent relationships" }).click();
  await expect(page.getByText("Explain the result", { exact: true })).toBeVisible();
  const packagesFolder = page.getByRole("treeitem", { name: "packages", exact: true });
  const serverFile = page.getByRole("treeitem", { name: "packages/harness-studio/src/server/server.ts", exact: true });
  await packagesFolder.getByRole("button", { name: "Collapse packages" }).click();
  await expect(packagesFolder).toHaveAttribute("aria-expanded", "false");
  await expect(serverFile).toHaveCount(0);
  await packagesFolder.getByRole("button", { name: "Expand packages" }).click();
  await expect(serverFile).toBeVisible();
  await packagesFolder.click();
  await expect(packagesFolder).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(packagesFolder).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(packagesFolder).toHaveAttribute("aria-expanded", "true");
  await expect(serverFile).toBeVisible();
  await page.getByText("Implement the input server route", { exact: true }).click();
  await expect(serverFile.locator(".input-tree-node")).toHaveClass(/linked/);
  await serverFile.click();
  await expect(serverFile).toHaveAttribute("aria-selected", "true");
  await expect(rows).toHaveCount(1);
  await expect(page.getByText("Implement the input server route", { exact: true })).toBeVisible();
  await expect(page.getByText("Inspect the design contract", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("input-trace-wide.png"), fullPage: true });

  await page.getByRole("button", { name: /packages\/harness-studio\/src\/server\/server\.ts/ }).click();
  await page.getByLabel("Filter by file activity").selectOption("unlinked");
  await expect(rows).toHaveCount(1);
  await expect(page.getByText("Explain the result", { exact: true })).toBeVisible();

  await page.getByLabel("Filter by file activity").selectOption("all");
  await page.setViewportSize({ width: 900, height: 760 });
  await page.getByRole("button", { name: "Analyze relationships" }).click();
  await expect(page.getByRole("region", { name: "Proposed Intent relationships" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("input-trace-compact.png"), fullPage: true });
  await page.getByRole("button", { name: "Close proposed Intent relationships" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Input trace panes" })).toBeVisible();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Files linked to user inputs" })).toBeVisible();
  await page.getByRole("treeitem", { name: "DESIGN.md", exact: true }).click();
  await expect(page.getByRole("button", { name: "Inputs", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Inspect the design contract", { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "Analyze relationships" }).click();
  await expect(page.getByRole("region", { name: "Proposed Intent relationships" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("input-trace-narrow.png"), fullPage: true });

  expect(failures).toEqual([]);
});
