import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { activateArtifactContribution } from "../../dist/server/artifacts/registry/artifact-provider-activation.js";
import { startHarnessStudioServer } from "../../dist/server/server.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = [
  { label: "architecture.dsl", contributionId: "structurizr-dsl", extension: "dsl", rendererId: "homology.structurizr-svg", rendererType: "homology-diagram-svg", lane: "external-fallback" },
  { label: "delivery-platform.d2", contributionId: "d2", extension: "d2", rendererId: "homology.d2-svg", rendererType: "homology-diagram-svg", lane: "external-fallback" },
  { label: "service-flow.mmd", contributionId: "mermaid", extension: "mmd", rendererId: "homology.mermaid-svg", rendererType: "homology-diagram-svg", lane: "external-override" },
  { label: "renderer-differential.ipynb", contributionId: "jupyter-notebook", extension: "ipynb", rendererId: "homology.jupyter-notebook", rendererType: "homology-notebook-read-only", lane: "external-fallback" },
  { label: "artifact-manifest-demo.canvas.tsx", contributionId: "cursor-canvas", format: "cursor-canvas-tsx", rendererId: "test.cursor-canvas", rendererType: "cursor-canvas-tsx", lane: "external-fallback", interactive: true },
];

let root;
let server;

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-external-host-browser-"));
  const artifactDirectory = join(root, "artifacts");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(artifactDirectory));
  for (const fixture of fixtures) {
    const source = fixture.interactive === true
      ? 'export default function CanvasContainer() { return <main data-container="provider-owned">Cursor-like Canvas source</main>; }\n'
      : `source for ${fixture.label}\n`;
    await writeFile(join(artifactDirectory, fixture.label), source, "utf8");
  }
  const provider = externalProvider();
  for (const fixture of fixtures) {
    await activateArtifactContribution(
      provider,
      fixture.contributionId,
      fixture.lane,
      fixture.format === undefined ? { extensions: [fixture.extension] } : { formats: [fixture.format] },
      { root },
    );
  }
  server = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    artifactDirectory,
    artifactProviderStateRoot: root,
    artifactProviders: [provider],
    canvasViewerRoot: join(root, "missing-canvas"),
    canvasSdkRoot: join(root, "missing-sdk"),
    walnutCacheRoot: join(root, "missing-walnut"),
    port: 0,
  });
});

test.afterAll(async () => {
  await server?.close();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

test("mounts every provider-defined external renderer through the generic hosted surface", async ({ page }, testInfo) => {
  const failures = [];
  const intentRequests = [];
  const forbiddenRequests = [];
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/intents")) intentRequests.push(path);
    if (path.includes("/interaction/proposals") || path.includes("/decisions") || path.includes("/agent-runs")) forbiddenRequests.push(path);
  });
  for (const viewport of [
    { name: "wide", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "narrow", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${server.url}/#/artifacts`);
    for (const fixture of fixtures) {
      const artifactsPane = page.getByRole("tab", { name: "Artifacts", exact: true });
      if (await artifactsPane.isVisible() && await artifactsPane.getAttribute("aria-selected") !== "true") await artifactsPane.click();
      await page.locator(".artifact-list-pane").getByRole("button", { name: new RegExp(escapeRegex(fixture.label)) }).click();
      const frameElement = page.locator(`iframe[title="Artifact preview: ${fixture.label}"]`);
      await expect(frameElement).toBeVisible();
      await expect(frameElement).toHaveAttribute("sandbox", "allow-scripts");
      const frameBox = await frameElement.boundingBox();
      const previewBox = await page.locator(".artifact-preview-pane").boundingBox();
      expect(frameBox?.width).toBeGreaterThan(fixture.interactive === true ? 250 : (previewBox?.width ?? 0) - 2);
      expect(frameBox?.height).toBeGreaterThan(200);
      const frame = page.frameLocator(`iframe[title="Artifact preview: ${fixture.label}"]`);
      await expect(frame.locator(`[data-external-renderer="${fixture.rendererId}"]`)).toHaveText(fixture.label);
      if (fixture.interactive === true) {
        const bridgeButton = frame.getByRole("button", { name: "Run provider bridge" });
        await bridgeButton.click();
        await expect(frame.locator("[data-provider-bridge-count]")).toHaveText("1");
        await frame.getByRole("button", { name: "Record selection" }).click();
        const intentPane = page.getByRole("complementary", { name: "Artifact collaboration" });
        await expect(intentPane).toContainText("Orders");
        const steeringButton = frame.getByRole("button", { name: "Record steering draft" });
        await steeringButton.focus();
        await expect(steeringButton).toBeFocused();
        await steeringButton.click();
        await expect(intentPane).toContainText("Steering draft");
        await expect(intentPane).toContainText("Recorded, not executed");
        await expect(intentPane).toContainText("Focus the order flow");
        await expect(intentPane.getByRole("textbox", { name: "Canvas steering" })).toHaveValue("Focus the order flow");
        await expect(intentPane.getByRole("button", { name: "Prepare with Provider" })).toBeVisible();
        await expect(intentPane.getByRole("heading", { name: /proposal/iu })).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`external-artifact-intent-${viewport.name}.png`), fullPage: true });
        await frame.getByRole("button", { name: "Race intents" }).click();
        await expect(intentPane).toContainText("Latest target");
        await expect(intentPane.getByLabel("Semantic target")).toHaveValue("json-canvas://node/race-latest");
      }
      await expect(page.getByText(/No renderer is available for this artifact/u)).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`external-artifact-host-${viewport.name}.png`), fullPage: true });
    const interactive = fixtures.find((fixture) => fixture.interactive === true);
    if (interactive === undefined) throw new Error("missing interactive fixture");
    const lateFrame = page.frameLocator(`iframe[title="Artifact preview: ${interactive.label}"]`);
    await lateFrame.getByRole("button", { name: "Reject after navigation" }).click();
    const artifactsPane = page.getByRole("tab", { name: "Artifacts", exact: true });
    if (await artifactsPane.isVisible() && await artifactsPane.getAttribute("aria-selected") !== "true") await artifactsPane.click();
    await page.locator(".artifact-list-pane").getByRole("button", { name: /architecture\.dsl/u }).click();
    await page.waitForTimeout(250);
    await expect(page.locator(".artifact-editor-header")).toContainText("architecture.dsl");
    await expect(page.getByText("The Host rejected this Canvas intent. No action was executed.")).toHaveCount(0);
  }
  expect(intentRequests.length).toBeGreaterThanOrEqual(15);
  expect(forbiddenRequests).toEqual([]);
  expect(failures).toEqual([]);
});

function externalProvider() {
  const contributions = fixtures.map((fixture) => ({
    id: fixture.contributionId,
    label: fixture.label,
    matcher: fixture.format === undefined ? { extensions: [fixture.extension] } : { formats: [fixture.format] },
    adapter: {
      id: `test.${fixture.contributionId}.adapter`,
      version: "1",
      schemaId: `test/${fixture.contributionId}/v1`,
      async adapt(context) {
        return {
          kind: "ArtifactDataSnapshotV1",
          artifactId: context.descriptor.id,
          revisionId: context.descriptor.revision.id,
          snapshotId: context.descriptor.adapter.snapshotId,
          adapter: { id: context.descriptor.adapter.id, version: context.descriptor.adapter.version },
          schemaId: context.descriptor.adapter.schemaId,
          summary: { label: context.descriptor.label, family: context.descriptor.family, format: context.descriptor.format },
          structure: [],
          semanticIndex: [],
          resources: [],
          diagnostics: [],
          payload: { kind: `external:test/${fixture.contributionId}/v1` },
        };
      },
    },
    renderer: { id: fixture.rendererId, label: fixture.label, provider: "homology", type: fixture.rendererType, status: "ready" },
    surface: {
      kind: "external-hosted",
      rendererId: fixture.rendererId,
      runtimeId: `${fixture.rendererId}.hosted`,
      securityProfileId: "opaque-web-v1",
      runtime: {
        id: `${fixture.rendererId}.hosted`,
        version: "1",
        async prepareDocument(context) {
          if (fixture.interactive !== true) {
            return `<!doctype html><html><body><main data-external-renderer="${fixture.rendererId}">${context.descriptor.label}</main></body></html>`;
          }
          const binding = JSON.stringify({
            kind: "HarnessStudioArtifactHostedIntentV1",
            protocolVersion: "1",
            artifactId: context.descriptor.id,
            revision: context.descriptor.revision.id,
            bindingId: context.descriptor.renderer.bindingId,
          });
          return `<!doctype html><html><body><main><span data-external-renderer="${fixture.rendererId}">${context.descriptor.label}</span><button type="button" id="provider-bridge">Run provider bridge</button><output data-provider-bridge-count>0</output><button type="button" id="record-selection">Record selection</button><button type="button" id="record-steering">Record steering draft</button><button type="button" id="race-intents">Race intents</button><button type="button" id="reject-late">Reject after navigation</button></main><script>const binding=${binding};let sequence=0;const emit=(action)=>parent.postMessage({...binding,intentId:"canvas-intent:"+(++sequence),intent:{action}},"*");document.getElementById("provider-bridge").addEventListener("click",()=>{const output=document.querySelector("[data-provider-bridge-count]");output.textContent=String(Number(output.textContent)+1);});document.getElementById("record-selection").addEventListener("click",()=>emit("select"));document.getElementById("record-steering").addEventListener("click",()=>emit("steer"));document.getElementById("race-intents").addEventListener("click",()=>{emit("race-delayed");emit("race-latest");});document.getElementById("reject-late").addEventListener("click",()=>emit("reject-delayed"));</script></body></html>`;
        },
        async readModule() { return "export {};\n"; },
        async readResource() { return undefined; },
      },
    },
    capabilities: fixture.interactive === true ? ["navigate", "select", "steer"] : ["navigate", "select"],
    ...(fixture.interactive === true ? {
      intent: {
        id: `${fixture.rendererId}.intent`,
        version: "1",
        protocolVersion: "1",
        async admit(_context, input) {
          const action = input.intent.action;
          if (action === "race-delayed") await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
          if (action === "reject-delayed") {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
            throw new Error("delayed fixture rejection");
          }
          if (action === "select" || action === "race-delayed" || action === "race-latest") {
            const label = action === "race-delayed" ? "Delayed target" : action === "race-latest" ? "Latest target" : "Orders";
            return {
              intentId: input.intentId,
              effect: { kind: "selection", target: { address: `json-canvas://node/${String(action)}`, kind: "node", label } },
            };
          }
          if (action === "steer") {
            return {
              intentId: input.intentId,
              effect: {
                kind: "steering",
                target: { address: "json-canvas://node/orders", kind: "node", label: "Orders" },
                steering: { kind: "canvas-steering", message: "Focus the order flow" },
              },
            };
          }
          throw new Error("unsupported fixture intent");
        },
      },
      interaction: {
        id: `${fixture.rendererId}.interaction`,
        version: "1",
        protocolVersion: "1",
        async inspect(context) {
          return {
            kind: "HarnessStudioArtifactInteractionWorkspaceV1",
            protocolVersion: "1",
            artifactId: context.descriptor.id,
            revision: context.descriptor.revision.id,
            summary: "Provider-owned Canvas targets",
            targets: [
              { address: "json-canvas://node/select", kind: "node", label: "Orders" },
              { address: "json-canvas://node/orders", kind: "node", label: "Orders" },
              { address: "json-canvas://node/race-delayed", kind: "node", label: "Delayed target" },
              { address: "json-canvas://node/race-latest", kind: "node", label: "Latest target" },
            ],
            steering: { kind: "canvas-steering", label: "Canvas steering", placeholder: "Describe the Canvas focus", maxLength: 200 },
          };
        },
        async prepare() { throw new Error("intent flow must not prepare"); },
        async decide() { throw new Error("intent flow must not decide"); },
      },
    } : {}),
    support: "experimental-local",
    adapterExecutionProfile: "trusted-local-process",
  }));
  const receipt = {
    kind: "HarnessStudioExternalArtifactProviderReceiptV1",
    providerId: "test.homology-artifacts",
    providerVersion: "1",
    providerDescriptorDigest: digest({ contributions: fixtures.map(({ contributionId, rendererId }) => [contributionId, rendererId]) }),
    assets: [],
    driverVersions: { "artifact-provider-api": "1" },
  };
  return {
    id: receipt.providerId,
    label: "Test Homology artifacts",
    version: receipt.providerVersion,
    acquisition: "operator-provisioned",
    fingerprint: digest(receipt),
    receipt,
    contributions,
  };
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
