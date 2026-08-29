import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isArtifactCatalogResponse, isArtifactDataSnapshot } from "../src/contracts/artifact.js";
import { activateArtifactContribution } from "../src/server/artifacts/registry/artifact-provider-activation.js";
import { PROVIDER_HOSTED_CANVAS_TSX_FORMAT } from "../src/server/artifacts/registry/artifact-catalog.js";
import { discoverCanvasViewers } from "../src/server/artifacts/registry/artifact-viewers.js";
import { envelopeSnapshot, type ExternalArtifactProvider } from "../src/server/artifacts/registry/artifact-plugin-registry.js";
import { createQoderArtifactProvider } from "../src/server/providers/qoder/artifact-provider.js";
import { startHarnessStudioServer, type HarnessStudioServerHandle } from "../src/server/server.js";

const temporary: string[] = [];
let server: HarnessStudioServerHandle | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("generic external hosted Artifact routes", () => {
  it("marks a malformed injected hosted intent runtime unavailable instead of invoking it", async () => {
    const root = await temp("artifact-invalid-intent-provider-");
    const appDir = join(root, "app");
    const artifactDirectory = join(root, "artifacts");
    await Promise.all([mkdir(appDir), mkdir(artifactDirectory)]);
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>fixture</title>", "utf8");
    await writeFile(join(artifactDirectory, "diagram.dsl"), "workspace {}", "utf8");
    const provider = injectedProvider();
    (provider.contributions[0] as unknown as { intent: unknown }).intent = {
      id: 42,
      version: "1",
      protocolVersion: "1",
      admit: "not-a-function",
    };
    server = await startHarnessStudioServer({
      appDir,
      artifactDirectory,
      artifactProviders: [provider],
      walnutCacheRoot: join(root, "walnut-cache"),
    });

    const status = await (await fetch(`${server.url}/api/artifact-providers`)).json() as {
      providers: Array<{ id: string; status: string; reason?: string }>;
    };
    expect(status.providers.find((candidate) => candidate.id === provider.id)).toMatchObject({
      status: "unavailable",
      reason: expect.stringMatching(/unsupported hosted intent runtime/u),
    });
  });

  it("accepts an explicitly injected fingerprint-bound Provider", async () => {
    const root = await temp("artifact-injected-provider-");
    const appDir = join(root, "app");
    const artifactDirectory = join(root, "artifacts");
    const stateRoot = join(root, "state");
    await Promise.all([mkdir(appDir), mkdir(artifactDirectory)]);
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>fixture</title>", "utf8");
    await writeFile(join(artifactDirectory, "diagram.dsl"), "workspace {}", "utf8");
    const provider = injectedProvider();
    await activateArtifactContribution(provider, "dsl", "external-fallback", { extensions: ["dsl"] }, { root: stateRoot });

    server = await startHarnessStudioServer({
      appDir,
      artifactDirectory,
      artifactProviderStateRoot: stateRoot,
      artifactProviders: [provider],
      walnutCacheRoot: join(root, "walnut-cache"),
    });

    const status = await (await fetch(`${server.url}/api/artifact-providers`)).json() as {
      providers: Array<{ id: string; status: string; receiptVerified: boolean; contributions: Array<{ active: boolean }> }>;
    };
    expect(status.providers.find((candidate) => candidate.id === provider.id)).toMatchObject({
      status: "ready",
      receiptVerified: true,
      contributions: [{ active: true }],
    });
    const catalogValue: unknown = await (await fetch(`${server.url}/api/artifacts`)).json();
    expect(isArtifactCatalogResponse(catalogValue)).toBe(true);
    if (!isArtifactCatalogResponse(catalogValue)) throw new Error("expected Artifact catalog");
    expect(catalogValue.artifacts[0]?.renderer).toMatchObject({
      id: "fixture.dsl",
      provider: "fixture",
      status: "ready",
      viewUri: expect.any(String),
    });
    const viewer = await fetch(`${server.url}${catalogValue.artifacts[0]!.renderer.viewUri}`);
    expect(viewer.status).toBe(200);
    expect(await viewer.text()).toContain("injected provider");
  });

  it("rebinds a real Canvas TSX file only after exact-format fallback activation", async () => {
    const root = await temp("artifact-canvas-provider-");
    const appDir = join(root, "app");
    const artifactDirectory = join(root, "artifacts");
    const stateRoot = join(root, "state");
    await Promise.all([mkdir(appDir), mkdir(artifactDirectory)]);
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>fixture</title>", "utf8");
    await writeFile(
      join(artifactDirectory, "artifact-manifest-demo.canvas.tsx"),
      'export default () => <main data-canvas-source="true">Canvas source</main>;\n',
      "utf8",
    );
    const provider = injectedCanvasProvider();
    expect(provider.contributions[0]?.matcher).toEqual({ formats: [PROVIDER_HOSTED_CANVAS_TSX_FORMAT] });
    server = await startHarnessStudioServer({
      appDir,
      artifactDirectory,
      artifactProviderStateRoot: stateRoot,
      artifactProviders: [provider],
      canvasViewerRoot: join(root, "missing-canvas"),
      canvasSdkRoot: join(root, "missing-sdk"),
      walnutCacheRoot: join(root, "missing-walnut"),
    });

    const beforeValue: unknown = await (await fetch(`${server.url}/api/artifacts`)).json();
    expect(isArtifactCatalogResponse(beforeValue)).toBe(true);
    if (!isArtifactCatalogResponse(beforeValue)) throw new Error("expected Artifact catalog");
    expect(beforeValue.artifacts[0]).toMatchObject({
      label: "artifact-manifest-demo.canvas.tsx",
      format: PROVIDER_HOSTED_CANVAS_TSX_FORMAT,
      backing: "code",
      renderer: { id: "studio.react-preview", type: "sandboxed-web", status: "ready" },
    });
    expect(beforeValue.artifacts[0]?.renderer.viewUri).toBeUndefined();

    const activated = await activateArtifactContribution(
      provider,
      "cursor-canvas",
      "external-fallback",
      { formats: [PROVIDER_HOSTED_CANVAS_TSX_FORMAT] },
      { root: stateRoot },
    );
    expect(activated.activations[0]?.matcher).toEqual({ formats: [PROVIDER_HOSTED_CANVAS_TSX_FORMAT] });

    const afterValue: unknown = await (await fetch(`${server.url}/api/artifacts`)).json();
    expect(isArtifactCatalogResponse(afterValue)).toBe(true);
    if (!isArtifactCatalogResponse(afterValue)) throw new Error("expected Artifact catalog");
    expect(afterValue.artifacts[0]).toMatchObject({
      label: "artifact-manifest-demo.canvas.tsx",
      format: PROVIDER_HOSTED_CANVAS_TSX_FORMAT,
      backing: "data",
      renderer: {
        id: "fixture.cursor-canvas",
        type: "cursor-canvas-tsx",
        status: "ready",
        viewUri: expect.any(String),
      },
    });
    expect(afterValue.snapshot.revision).not.toBe(beforeValue.snapshot.revision);
    const viewer = await fetch(`${server.url}${afterValue.artifacts[0]!.renderer.viewUri}`);
    expect(viewer.status).toBe(200);
    expect(await viewer.text()).toContain("provider-owned Canvas container");
  });

  it("serves an activated Qoder contribution without Qoder fields in the common binding", async () => {
    const root = await temp("artifact-provider-server-");
    const appDir = join(root, "app");
    const artifactDirectory = join(root, "artifacts");
    const viewerRoot = join(root, "viewers");
    const viewer = join(viewerRoot, "fixture");
    const sdkMedia = join(root, "sdk-media");
    const stateRoot = join(root, "state");
    await Promise.all([
      mkdir(appDir, { recursive: true }),
      mkdir(artifactDirectory, { recursive: true }),
      mkdir(join(viewer, "scripts"), { recursive: true }),
      mkdir(sdkMedia, { recursive: true }),
    ]);
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>fixture</title>", "utf8");
    await writeFile(join(artifactDirectory, "report.bin"), "artifact bytes", "utf8");
    await writeFile(join(viewer, "manifest.json"), JSON.stringify({
      id: "fixture", label: "Fixture hosted renderer", extensions: ["bin"], dataKey: "fixture",
    }), "utf8");
    await writeFile(join(viewer, "index.canvas.tsx"), 'import { Stack } from "qoder/canvas"; export default () => <Stack />;\n', "utf8");
    await writeFile(join(viewer, "style.css"), ".fixture { color: red; }\n", "utf8");
    await writeFile(join(viewer, "scripts", "index.mjs"), [
      'import { writeFile } from "node:fs/promises";',
      'const args = JSON.parse(process.env.AICODING_CANVAS_SCRIPT_ARGS ?? "{}");',
      'await writeFile(process.env.AICODING_CANVAS_DATA, JSON.stringify({ fixture: { sourcePath: args.targetFilePath, value: "adapted" } }));',
    ].join("\n"), "utf8");
    const sdkPath = join(sdkMedia, "canvas-sdk.js");
    const sdkMapPath = join(sdkMedia, "canvas-sdk.js.map");
    const htmlTemplatePath = join(sdkMedia, "index-canvas.html");
    await writeFile(sdkPath, "export const mountCanvas = () => {};\n", "utf8");
    await writeFile(sdkMapPath, JSON.stringify({ version: 3, sources: [], mappings: "" }), "utf8");
    await writeFile(htmlTemplatePath, '<html><head></head><body><script>const options = { data: new Map() }; mountCanvas("/canvas-module.js?v=1")</script></body></html>', "utf8");

    const discovered = (await discoverCanvasViewers(viewerRoot))[0]!;
    const provider = await createQoderArtifactProvider(discovered, { sdkPath, sdkMapPath, htmlTemplatePath });
    await activateArtifactContribution(provider, "fixture", "external-fallback", { extensions: ["bin"] }, { root: stateRoot });
    server = await startHarnessStudioServer({
      appDir,
      artifactDirectory,
      canvasViewerRoot: viewerRoot,
      canvasSdkMedia: sdkMedia,
      artifactProviderStateRoot: stateRoot,
      walnutCacheRoot: join(root, "walnut-cache"),
    });

    const catalogValue: unknown = await (await fetch(`${server.url}/api/artifacts`)).json();
    expect(isArtifactCatalogResponse(catalogValue)).toBe(true);
    if (!isArtifactCatalogResponse(catalogValue)) throw new Error("expected Artifact catalog");
    const descriptor = catalogValue.artifacts[0]!;
    expect(descriptor).toMatchObject({
      adapter: { schemaId: "qoder-canvas/fixture/v1" },
      renderer: { id: "qoder-canvas.fixture", type: "qoder-canvas", status: "ready", viewUri: expect.any(String) },
    });
    const snapshotValue: unknown = await (await fetch(`${server.url}${descriptor.adapter.snapshotUri}`)).json();
    expect(isArtifactDataSnapshot(snapshotValue)).toBe(true);
    if (!isArtifactDataSnapshot(snapshotValue)) throw new Error("expected Artifact snapshot");
    expect(snapshotValue.payload).toMatchObject({ kind: "qoder-canvas/v1", data: { fixture: { value: "adapted" } } });

    const viewerResponse = await fetch(`${server.url}${descriptor.renderer.viewUri}`);
    expect(viewerResponse.status).toBe(200);
    const hostedCsp = viewerResponse.headers.get("content-security-policy");
    expect(hostedCsp).toContain("connect-src 'self'");
    expect(hostedCsp).not.toMatch(/connect-src[^;]*https?:/u);
    expect(await viewerResponse.text()).toContain("runtime-module.js");
    const base = descriptor.renderer.viewUri!;
    expect((await fetch(`${server.url}${base}runtime-module.js`)).headers.get("content-type")).toContain("javascript");
    expect((await fetch(`${server.url}${base}runtime-module.js.map`)).status).toBe(200);
    expect(await (await fetch(`${server.url}${base}style.css`)).text()).toContain("color: red");

    await writeFile(sdkPath, "export const mountCanvas = () => 'changed';\n", "utf8");
    expect((await fetch(`${server.url}${descriptor.renderer.viewUri}`)).status).toBe(415);
    const refreshed = await (await fetch(`${server.url}/api/artifacts`)).json() as { artifacts: Array<{ renderer: { id: string; status: string } }> };
    expect(refreshed.artifacts[0]!.renderer).toMatchObject({
      id: "studio.text",
      provider: "studio",
      type: "native",
      status: "ready",
    });
  });
});

function injectedProvider(): ExternalArtifactProvider {
  const receipt: ExternalArtifactProvider["receipt"] = {
    kind: "HarnessStudioExternalArtifactProviderReceiptV1",
    providerId: "fixture.injected",
    providerVersion: "1",
    providerDescriptorDigest: `sha256:${"b".repeat(64)}`,
    assets: [],
    driverVersions: { fixture: "1" },
  };
  const fingerprint = `sha256:${createHash("sha256").update(JSON.stringify(receipt)).digest("hex")}` as const;
  return {
    id: receipt.providerId,
    label: "Injected fixture",
    version: receipt.providerVersion,
    acquisition: "operator-provisioned",
    fingerprint,
    receipt,
    contributions: [{
      id: "dsl",
      label: "Fixture DSL",
      matcher: { extensions: ["dsl"] },
      adapter: {
        id: "fixture.dsl.adapter",
        version: "1",
        schemaId: "fixture/dsl-v1",
        adapt: async (context) => await envelopeSnapshot(context, { kind: "fixture/dsl-v1" }),
      },
      renderer: { id: "fixture.dsl", label: "Fixture DSL", provider: "fixture", type: "external-hosted", status: "ready" },
      surface: {
        kind: "external-hosted",
        rendererId: "fixture.dsl",
        runtimeId: "fixture.dsl.runtime",
        securityProfileId: "opaque-web-v1",
        runtime: {
          id: "fixture.dsl.runtime",
          version: "1",
          prepareDocument: async () => "<!doctype html><title>injected provider</title>",
          readModule: async () => "export {};",
          readResource: async () => undefined,
        },
      },
      capabilities: ["navigate"],
      support: "experimental-local",
      adapterExecutionProfile: "trusted-local-process",
    }],
  };
}

function injectedCanvasProvider(): ExternalArtifactProvider {
  const receipt: ExternalArtifactProvider["receipt"] = {
    kind: "HarnessStudioExternalArtifactProviderReceiptV1",
    providerId: "fixture.cursor-canvas",
    providerVersion: "1",
    providerDescriptorDigest: `sha256:${"c".repeat(64)}`,
    assets: [],
    driverVersions: { fixture: "1" },
  };
  const fingerprint = `sha256:${createHash("sha256").update(JSON.stringify(receipt)).digest("hex")}` as const;
  return {
    id: receipt.providerId,
    label: "Fixture Cursor-like Canvas",
    version: receipt.providerVersion,
    acquisition: "operator-provisioned",
    fingerprint,
    receipt,
    contributions: [{
      id: "cursor-canvas",
      label: "Fixture Cursor-like Canvas container",
      matcher: { formats: [PROVIDER_HOSTED_CANVAS_TSX_FORMAT] },
      adapter: {
        id: "fixture.cursor-canvas.adapter",
        version: "1",
        schemaId: "fixture/cursor-canvas-v1",
        adapt: async (context) => await envelopeSnapshot(context, { kind: "fixture/cursor-canvas-v1" }),
      },
      renderer: {
        id: "fixture.cursor-canvas",
        label: "Fixture Cursor-like Canvas",
        provider: "fixture",
        type: "cursor-canvas-tsx",
        status: "ready",
      },
      surface: {
        kind: "external-hosted",
        rendererId: "fixture.cursor-canvas",
        runtimeId: "fixture.cursor-canvas.runtime",
        securityProfileId: "opaque-web-v1",
        runtime: {
          id: "fixture.cursor-canvas.runtime",
          version: "1",
          prepareDocument: async () => "<!doctype html><main>provider-owned Canvas container</main>",
          readModule: async () => "export {};",
          readResource: async () => undefined,
        },
      },
      capabilities: ["execute", "select"],
      support: "experimental-local",
      adapterExecutionProfile: "trusted-local-process",
    }],
  };
}

async function temp(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(path);
  return path;
}
