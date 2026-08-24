import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileTrustedRendererModule } from "../src/server/trusted-renderer-compiler.js";
import {
  artifactIdForLabel,
  artifactThreadIdForLabel,
  PROVIDER_HOSTED_CANVAS_TSX_FORMAT,
  type ArtifactEntry,
} from "../src/server/artifact-catalog.js";
import { adaptQoderCanvasViewerData } from "../src/server/qoder-canvas-viewer-bridge.js";
import { createArtifactPluginRegistry } from "../src/server/artifact-plugin-registry.js";
import { defaultCanvasViewerRoot, discoverCanvasViewers } from "../src/server/artifact-viewers.js";
import { createQoderArtifactProvider } from "../src/server/qoder-artifact-provider.js";
import type { ArtifactExternalLane, ArtifactProviderActivation, ExternalArtifactProvider } from "../src/server/artifact-adapter-contract.js";
import type { QoderCanvasRuntime } from "../src/server/qoder-canvas-viewer-bridge.js";

describe("Artifact plugin registry and the Qoder Canvas provider", () => {
  it("advertises only capabilities implemented by each built-in surface", () => {
    const registry = createArtifactPluginRegistry();
    const expected = [
      ["notes.md", "markdown", ["navigate", "outline"]],
      ["document.docx", "docx", ["navigate", "outline", "select", "zoom"]],
      ["deck.pptx", "pptx", ["navigate", "outline", "select", "zoom"]],
      ["workbook.xlsx", "xlsx", ["navigate", "select"]],
      ["component.tsx", "code", []],
      ["component.canvas.tsx", "code", ["execute", "live-update"]],
      ["diagram.svg", "svg", ["live-update"]],
      ["diagram.mmd", "mermaid", ["live-update"]],
      ["source.ts", "code", []],
      ["change.diff", "diff", []],
      ["data.json", "json", []],
      ["photo.png", "image", []],
      ["notes.txt", "text", []],
    ] as const;

    for (const [label, kind, capabilities] of expected) {
      expect(registry.resolve(entry(label, kind)).capabilities, label).toEqual(capabilities);
    }
  });

  it("uses the Qoder canvas/canvases directory", () => {
    expect(defaultCanvasViewerRoot({ QODER_HOME: "/qoder-home" }, "/home/test")).toBe(join(resolve("/qoder-home"), "canvas", "canvases"));
    expect(defaultCanvasViewerRoot({}, "/home/test")).toBe(join("/home/test", ".qoder", "canvas", "canvases"));
  });

  it("discovers a viewer and keeps native rendering ahead of non-overrides", async () => {
    const root = await fakeViewerRoot(false);
    const viewers = await discoverCanvasViewers(root);
    const provider = await createQoderArtifactProvider(viewers[0]!, await fakeRuntime(root));
    expect(viewers).toHaveLength(1);
    expect(resolve_(entry("deck.pptx", "pptx"), [provider], "external-fallback")).toMatchObject({ renderer: { id: "studio.pptx-dom", type: "native" } });
    expect(resolve_(entry("workbook.xlsx", "xlsx"), [provider], "external-fallback")).toMatchObject({ renderer: { id: "studio.xlsx-grid", type: "native" } });
    expect(resolve_(entry("diagram.svg", "svg"), [provider], "external-override")).toMatchObject({ renderer: { id: "qoder-canvas.pptx" } });
    expect(resolve_(entry("diagram.svg", "svg"), [provider], "external-fallback")).toMatchObject({
      backing: "code",
      buildRuntime: { id: "studio.svg-react" },
      renderer: { id: "studio.svg-react-preview", type: "sandboxed-web" },
    });
    expect(resolve_(entry("archive.bin", "unknown"), [provider], "external-fallback")).toMatchObject({ renderer: { id: "qoder-canvas.pptx", type: "qoder-canvas" } });
  });

  it("lets an explicit manifest override replace a direct renderer", async () => {
    const root = await fakeViewerRoot(true);
    const viewers = await discoverCanvasViewers(root);
    const provider = await createQoderArtifactProvider(viewers[0]!, await fakeRuntime(root));
    expect(provider.contributions[0]?.legacyOverrideRequested).toBe(true);
    expect(resolve_(entry("deck.pptx", "pptx"), [provider], "external-override")).toMatchObject({ renderer: { id: "qoder-canvas.pptx", type: "qoder-canvas" } });
    expect(resolve_(entry("diagram.svg", "svg"), [provider], "external-override")).toMatchObject({ renderer: { id: "qoder-canvas.pptx" } });
  });

  it("keeps an explicit override ahead of a non-overriding viewer that sorts first", async () => {
    // The declared priority puts an operator override above Studio's native
    // renderer. Inspecting only the first match would silently drop it whenever
    // another viewer for the same extension came earlier in discovery order.
    const plainRoot = await fakeViewerRoot(false, "a-plain");
    const overrideRoot = await fakeViewerRoot(true, "z-override");
    const plain = await createQoderArtifactProvider((await discoverCanvasViewers(plainRoot))[0]!, await fakeRuntime(plainRoot));
    const override = await createQoderArtifactProvider((await discoverCanvasViewers(overrideRoot))[0]!, await fakeRuntime(overrideRoot));
    const registry = createArtifactPluginRegistry({
      externalProviders: [plain, override],
      activations: [activation(plain, "external-fallback"), activation(override, "external-override")],
    });
    expect(registry.resolve(entry("deck.pptx", "pptx")).renderer.id).toBe("qoder-canvas.z-override");
    expect(resolve_(entry("deck.pptx", "pptx"), [plain], "external-fallback").renderer.id).toBe("studio.pptx-dom");

    const conflict = createArtifactPluginRegistry({
      externalProviders: [plain, override],
      activations: [activation(plain, "external-override"), activation(override, "external-override")],
    });
    expect(conflict.resolve(entry("deck.pptx", "pptx")).renderer.id).toBe("studio.pptx-dom");
    expect(conflict.resolve(entry("archive.bin", "unknown")).renderer).toMatchObject({
      id: "studio.unavailable",
      reason: expect.stringContaining("Multiple activated"),
    });
  });

  it("prefers only an exact-format Canvas fallback before protected React", async () => {
    const root = await fakeViewerRoot(false);
    const discovered = await createQoderArtifactProvider(
      (await discoverCanvasViewers(root))[0]!,
      await fakeRuntime(root),
    );
    const exact = {
      ...discovered,
      contributions: [{
        ...discovered.contributions[0]!,
        matcher: { formats: [PROVIDER_HOSTED_CANVAS_TSX_FORMAT] },
      }],
    } satisfies ExternalArtifactProvider;
    const canvasEntry = entry("artifact-manifest-demo.canvas.tsx", "code");

    expect(createArtifactPluginRegistry().resolve(canvasEntry).renderer.id).toBe("studio.react-preview");
    expect(resolve_(canvasEntry, [exact], "external-fallback").renderer.id).toBe("qoder-canvas.pptx");
    expect(resolve_(entry("ordinary.tsx", "code"), [exact], "external-fallback").renderer.id)
      .toBe("studio.code");

    for (const matcher of [{ extensions: ["tsx"] }, { pathGlobs: ["**/*.canvas.tsx"] }]) {
      const broad = {
        ...discovered,
        contributions: [{ ...discovered.contributions[0]!, matcher }],
      } satisfies ExternalArtifactProvider;
      expect(resolve_(canvasEntry, [broad], "external-fallback").renderer.id).toBe("studio.react-preview");
    }
  });

  it("preserves Canvas SDK imports when compiling trusted viewer code", async () => {
    const viewers = await discoverCanvasViewers(await fakeViewerRoot(false));
    const compiled = await compileTrustedRendererModule(viewers[0]!.modulePath);
    expect(compiled.code).toContain('from "qoder/canvas"');
  });

  it("moves the provider fingerprint when receipt-covered runtime bytes change", async () => {
    const root = await fakeViewerRoot(false);
    const viewer = (await discoverCanvasViewers(root))[0]!;
    const runtime = await fakeRuntime(root);
    const first = await createQoderArtifactProvider(viewer, runtime);
    await writeFile(runtime.sdkPath, "export const mountCanvas = () => 'changed';\n", "utf8");
    const second = await createQoderArtifactProvider(viewer, runtime);

    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(first.receipt.assets.map((asset) => asset.role)).toEqual(expect.arrayContaining([
      "manifest", "renderer", "sidecar", "canvas-sdk", "canvas-html", "canvas-sdk-map",
    ]));
  });

  it("generates request-scoped data without consuming an artifact-adjacent cache", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artifact-input-"));
    const path = join(directory, "deck.pptx");
    await writeFile(path, "pptx bytes", "utf8");
    await writeFile(join(directory, "deck.canvas.data.json"), JSON.stringify({ officePresentation: { stale: true } }), "utf8");
    const viewer = (await discoverCanvasViewers(await fakeViewerRoot(false)))[0]!;
    const payload = await adaptQoderCanvasViewerData({ ...entry("deck.pptx", "unknown"), path, size: 10 }, viewer);
    expect(payload.officePresentation).toMatchObject({ error: "", generated: true });
    expect(payload.officePresentation).not.toHaveProperty("stale");
  });

  it("rejects sidecar data for a different source path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artifact-input-"));
    const path = join(directory, "deck.pptx");
    await writeFile(path, "pptx bytes", "utf8");
    const viewer = (await discoverCanvasViewers(await fakeViewerRoot(false)))[0]!;
    await writeFile(viewer.scriptPath!, [
      'import { writeFile } from "node:fs/promises";',
      'await writeFile(process.env.AICODING_CANVAS_DATA, JSON.stringify({ officePresentation: { error: "", sourcePath: "/another/deck.pptx" } }));',
    ].join("\n"), "utf8");
    await expect(adaptQoderCanvasViewerData({ ...entry("deck.pptx", "unknown"), path, size: 10 }, viewer)).rejects.toThrow(/does not describe/u);
  });
});

function resolve_(entry: ArtifactEntry, providers: readonly ExternalArtifactProvider[], lane: ArtifactExternalLane) {
  return createArtifactPluginRegistry({ externalProviders: providers, activations: providers.map((provider) => activation(provider, lane)) }).resolve(entry);
}

function activation(provider: ExternalArtifactProvider, lane: ArtifactExternalLane): ArtifactProviderActivation {
  const contribution = provider.contributions[0]!;
  return {
    providerId: provider.id,
    contributionId: contribution.id,
    fingerprint: provider.fingerprint,
    lane,
    matcher: contribution.matcher,
    contributionSupport: contribution.support,
    ...(contribution.adapterExecutionProfile === undefined ? {} : { adapterExecutionProfile: contribution.adapterExecutionProfile }),
    surfaceSecurityProfile: "opaque-web-v1",
    consent: "explicit",
    activatedAt: "2026-08-22T00:00:00.000Z",
  };
}

function entry(label: string, kind: ArtifactEntry["kind"]): ArtifactEntry {
  return {
    id: artifactIdForLabel(label),
    threadId: artifactThreadIdForLabel(label),
    kind,
    label,
    path: `/artifacts/${label}`,
    size: 1,
  };
}

async function fakeViewerRoot(overrideBuiltIn: boolean, id = "pptx"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "canvas-viewers-"));
  const viewer = join(root, id);
  await mkdir(join(viewer, "scripts"), { recursive: true });
  await writeFile(join(viewer, "manifest.json"), JSON.stringify({
    id,
    label: "PowerPoint Presentation",
    extensions: ["pptx", "svg", "bin"],
    dataKey: "officePresentation",
    overrideBuiltIn,
  }), "utf8");
  await writeFile(join(viewer, "index.canvas.tsx"), 'import { Stack } from "qoder/canvas"; export default function Viewer() { return <Stack />; }\n', "utf8");
  await writeFile(join(viewer, "scripts", "index.mjs"), [
    'import { writeFile } from "node:fs/promises";',
    'const data = process.env.AICODING_CANVAS_DATA;',
    'const args = JSON.parse(process.env.AICODING_CANVAS_SCRIPT_ARGS ?? "{}");',
    'await writeFile(data, JSON.stringify({ officePresentation: { error: "", generated: true, sourcePath: args.targetFilePath } }));',
  ].join("\n"), "utf8");
  return root;
}

async function fakeRuntime(root: string): Promise<QoderCanvasRuntime> {
  const runtime = join(root, "..", `runtime-${basename(root)}`);
  await mkdir(runtime, { recursive: true });
  const sdkPath = join(runtime, "canvas-sdk.js");
  const sdkMapPath = join(runtime, "canvas-sdk.js.map");
  const htmlTemplatePath = join(runtime, "index-canvas.html");
  await writeFile(sdkPath, "export const mountCanvas = () => {};\n", "utf8");
  await writeFile(sdkMapPath, JSON.stringify({ version: 3, sources: [], mappings: "" }), "utf8");
  await writeFile(htmlTemplatePath, '<html><head></head><body><script>const options = { data: new Map(), targetFilePath: "" }; mountCanvas("/canvas-module.js?v=1")</script></body></html>', "utf8");
  return { sdkPath, sdkMapPath, htmlTemplatePath };
}
