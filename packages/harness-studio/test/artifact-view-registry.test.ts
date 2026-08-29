import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import type { ArtifactDescriptor, ArtifactRendererReference } from "../src/contracts/artifact.js";
import {
  ARTIFACT_SURFACE_MOUNTS,
  ArtifactView,
  artifactSurfaceInstanceKey,
  normalizeArtifactSurfaceKind,
  resolveArtifactSurfaceMount,
} from "../src/app/artifacts/ArtifactView.js";
import {
  forwardHostedArtifactIntent,
  hostedArtifactIntent,
  hostedArtifactIntentFromFrame,
  hostedArtifactIntentOutcome,
  hostedArtifactSelection,
  hostedArtifactSelectionFromFrame,
} from "../src/app/artifacts/ExternalHostedArtifactView.js";
import { namespaces as enNamespaces } from "../src/app/i18n/en/index.js";

const testI18n = createInstance();
testI18n.use(initReactI18next).init({
  resources: { en: enNamespaces },
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

function renderView(props: Parameters<typeof ArtifactView>[0]): string {
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n: testI18n }, createElement(ArtifactView, props)));
}

describe("Artifact View surface registry", () => {
  it("keeps one stable ordered composition boundary for every view family", () => {
    expect(ARTIFACT_SURFACE_MOUNTS.map((mount) => mount.id)).toEqual([
      "studio.agent-react-preview",
      "studio.sandboxed-preview",
      "external-hosted",
      "studio.markdown",
      "studio.docx-dom",
      "studio.pdf-canvas",
      "studio.pptx-dom",
      "studio.xlsx-grid",
      "studio.image",
      "studio.text-family",
    ]);
  });

  it.each([
    ["AgentReact", descriptor({ id: "studio.agent-react-preview", type: "sandboxed-web" }, { backing: "code", format: "agent-react-tsx" }), "studio.agent-react-preview"],
    ["dynamic React", descriptor({ id: "studio.react-preview", type: "sandboxed-web" }, { backing: "code", format: "tsx" }), "studio.sandboxed-preview"],
    ["Qoder Canvas", descriptor({ id: "qoder-canvas.deck", type: "qoder-canvas", viewUri: "/api/artifacts/deck/view" }), "external-hosted"],
    ["Structurizr", descriptor({ id: "homology.structurizr-svg", type: "homology-diagram-svg", viewUri: "/api/artifacts/structurizr/view" }, { format: "dsl" }), "external-hosted"],
    ["D2", descriptor({ id: "homology.d2-svg", type: "homology-diagram-svg", viewUri: "/api/artifacts/d2/view" }, { format: "d2" }), "external-hosted"],
    ["external Mermaid", descriptor({ id: "homology.mermaid-svg", type: "homology-diagram-svg", viewUri: "/api/artifacts/mermaid/view" }, { format: "mmd" }), "external-hosted"],
    ["Jupyter Notebook", descriptor({ id: "homology.jupyter-notebook", type: "homology-notebook-read-only", viewUri: "/api/artifacts/notebook/view" }, { format: "ipynb" }), "external-hosted"],
    ["PDF", descriptor({ id: "studio.pdf-canvas", type: "native" }, { format: "pdf" }), "studio.pdf-canvas"],
    ["Cursor Canvas TSX container", descriptor({ id: "provider.cursor-canvas", type: "cursor-canvas-tsx", viewUri: "/api/artifacts/cursor-container/view" }, { format: "cursor-canvas-tsx" }), "external-hosted"],
    ["Markdown", descriptor({ id: "studio.markdown" }, { format: "md" }), "studio.markdown"],
    ["DOCX", descriptor({ id: "studio.docx-dom" }, { format: "docx" }), "studio.docx-dom"],
    ["PPTX", descriptor({ id: "studio.pptx-dom" }, { format: "pptx" }), "studio.pptx-dom"],
    ["XLSX", descriptor({ id: "studio.xlsx-grid" }, { format: "xlsx" }), "studio.xlsx-grid"],
    ["SVG", descriptor({ id: "studio.svg-react-preview", type: "sandboxed-web" }, { backing: "code", format: "svg" }), "studio.sandboxed-preview"],
    ["Mermaid", descriptor({ id: "studio.mermaid-react-preview", type: "sandboxed-web" }, { backing: "code", format: "mmd" }), "studio.sandboxed-preview"],
    ["image", descriptor({ id: "studio.image" }, { format: "png" }), "studio.image"],
    ["code", descriptor({ id: "studio.code" }, { format: "ts" }), "studio.text-family"],
    ["diff", descriptor({ id: "studio.diff" }, { format: "diff" }), "studio.text-family"],
    ["JSON", descriptor({ id: "studio.json" }, { format: "json" }), "studio.text-family"],
    ["text", descriptor({ id: "studio.text" }, { format: "txt" }), "studio.text-family"],
  ])("resolves the server-selected %s renderer", (_label, artifact, expected) => {
    expect(resolveArtifactSurfaceMount(artifact)?.id).toBe(expected);
  });

  it("does not reclassify an unknown renderer from a familiar extension", () => {
    const artifact = descriptor({ id: "future.deck-renderer" }, { label: "deck.pptx", format: "pptx" });
    expect(resolveArtifactSurfaceMount(artifact)).toBeUndefined();
    expect(renderView({ authorityId: "catalog-a", artifact, liveGeneration: 0 }))
      .toContain("No renderer is available for this artifact (future.deck-renderer).");
    expect(resolveArtifactSurfaceMount(descriptor({ id: "studio.pptx-dom", type: "future-native" }, { format: "pptx" }))).toBeUndefined();
  });

  it("rejects a malformed hosted renderer and preserves unavailable reasons", () => {
    const missingView = descriptor({ id: "qoder-canvas.deck", type: "qoder-canvas" });
    expect(normalizeArtifactSurfaceKind(missingView)).toBe("external-hosted");
    expect(resolveArtifactSurfaceMount(missingView)).toBeUndefined();

    const unavailable = descriptor({
      id: "studio.unavailable",
      type: "unavailable",
      status: "unavailable",
      reason: "No approved renderer matches this revision.",
    });
    const markup = renderView({ authorityId: "catalog-a", artifact: unavailable, liveGeneration: 0 });
    expect(markup).toContain('role="status"');
    expect(markup).toContain("No approved renderer matches this revision.");
  });

  it("does not infer external hosting from an unknown renderer type without a server view URI", () => {
    const missingView = descriptor({ id: "homology.structurizr-svg", type: "homology-diagram-svg" }, { format: "dsl" });
    expect(normalizeArtifactSurfaceKind(missingView)).toBe("unavailable");
    expect(resolveArtifactSurfaceMount(missingView)).toBeUndefined();
  });

  it("retains a mounted surface across content revisions for the same authority and binding", () => {
    const first = descriptor({
      id: "provider.diagram",
      provider: "provider-a",
      type: "provider-svg",
      bindingId: BINDING_DIGEST,
      viewUri: "/api/artifacts/example/revisions/111/viewer/",
    });
    const second = {
      ...first,
      revision: {
        ...first.revision,
        id: NEXT_DIGEST,
        digest: NEXT_DIGEST,
        content: { ...first.revision.content, digest: NEXT_DIGEST },
      },
      adapter: { ...first.adapter, snapshotId: NEXT_DIGEST },
      renderer: { ...first.renderer, viewUri: "/api/artifacts/example/revisions/222/viewer/" },
    };
    const firstMount = resolveArtifactSurfaceMount(first)!;
    const secondMount = resolveArtifactSurfaceMount(second)!;

    expect(artifactSurfaceInstanceKey(firstMount, "catalog-a", first))
      .toBe(artifactSurfaceInstanceKey(secondMount, "catalog-a", second));
  });

  it("accepts hosted selection only for the exact interactive Artifact revision and binding", () => {
    const artifact = {
      ...descriptor({
        id: "provider.diagram",
        provider: "provider-a",
        type: "provider-svg",
        bindingId: BINDING_DIGEST,
        viewUri: "/api/artifacts/example/revisions/111/viewer/",
      }),
      interaction: { workspaceUri: "/api/artifacts/example/revisions/111/interaction" },
    };
    const event = {
      kind: "HarnessStudioArtifactHostedSelectionV1",
      protocolVersion: "1",
      artifactId: artifact.id,
      revision: artifact.revision.id,
      bindingId: BINDING_DIGEST,
      address: "drawio://example.drawio/page/main/cell/orders",
    };

    expect(hostedArtifactSelection(event, artifact)).toEqual(event);
    expect(hostedArtifactSelection({ ...event, revision: NEXT_DIGEST }, artifact)).toBeUndefined();
    expect(hostedArtifactSelection({ ...event, bindingId: NEXT_DIGEST }, artifact)).toBeUndefined();
    expect(hostedArtifactSelection({ ...event, address: "" }, artifact)).toBeUndefined();
    expect(hostedArtifactSelection({ ...event, address: "x".repeat(8_193) }, artifact)).toBeUndefined();
    expect(hostedArtifactSelection(event, { ...artifact, interaction: undefined })).toBeUndefined();

    const frameWindow = {} as Window;
    expect(hostedArtifactSelectionFromFrame({ source: frameWindow, data: event }, frameWindow, artifact)).toEqual(event);
    expect(hostedArtifactSelectionFromFrame({ source: {} as Window, data: event }, frameWindow, artifact)).toBeUndefined();
    expect(hostedArtifactSelectionFromFrame({ source: null, data: event }, null, artifact)).toBeUndefined();
  });

  it("forwards hosted intents only from the current frame and exact Artifact binding", async () => {
    const artifact = {
      ...descriptor({
        id: "provider.json-canvas",
        provider: "provider-a",
        type: "provider-json-canvas",
        bindingId: BINDING_DIGEST,
        viewUri: "/api/artifacts/example/revisions/111/viewer/",
      }),
      intent: { intentUri: "/api/artifacts/example/revisions/111/intents" },
    };
    const intent = {
      kind: "HarnessStudioArtifactHostedIntentV1",
      protocolVersion: "1",
      artifactId: artifact.id,
      revision: artifact.revision.id,
      bindingId: BINDING_DIGEST,
      intentId: "intent:select-orders",
      intent: { action: "select", address: "json-canvas://node/orders" },
    } as const;
    const frameWindow = {} as Window;

    expect(hostedArtifactIntent(intent, artifact)).toEqual(intent);
    expect(hostedArtifactIntent({ ...intent, actor: { id: "forged" } }, artifact)).toBeUndefined();
    expect(hostedArtifactIntent({ ...intent, revision: NEXT_DIGEST }, artifact)).toBeUndefined();
    expect(hostedArtifactIntent(intent, { ...artifact, intent: undefined })).toBeUndefined();
    expect(hostedArtifactIntentFromFrame({ source: frameWindow, data: intent }, frameWindow, artifact)).toEqual(intent);
    expect(hostedArtifactIntentFromFrame({ source: {} as Window, data: intent }, frameWindow, artifact)).toBeUndefined();

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: Record<string, unknown> = {};
    const deepRoot = deep;
    for (let index = 0; index < 18; index += 1) {
      const child: Record<string, unknown> = {};
      deep.child = child;
      deep = child;
    }
    const invalidIntent = (payload: unknown): unknown => hostedArtifactIntent({ ...intent, intent: payload }, artifact);
    expect(invalidIntent(cyclic)).toBeUndefined();
    expect(invalidIntent({ value: 1n })).toBeUndefined();
    expect(invalidIntent(deepRoot)).toBeUndefined();
    expect(invalidIntent({ values: Array.from({ length: 2_049 }, () => null) })).toBeUndefined();
    expect(invalidIntent({ message: "x".repeat(8_193) })).toBeUndefined();
    expect(invalidIntent(JSON.parse('{"__proto__":{"admin":true}}') as unknown)).toBeUndefined();
    expect(invalidIntent({ value: Number.NaN })).toBeUndefined();
    expect(invalidIntent(new Map([["action", "select"]]))).toBeUndefined();
    expect(invalidIntent({ ["k".repeat(257)]: "value" })).toBeUndefined();
    expect(invalidIntent({ values: Array.from({ length: 100 }, () => "x".repeat(400)) })).toBeUndefined();

    const outcome = {
      kind: "HarnessStudioArtifactHostedIntentOutcomeV1",
      protocolVersion: "1",
      artifactId: artifact.id,
      revision: artifact.revision.id,
      bindingId: BINDING_DIGEST,
      intentId: intent.intentId,
      actor: { id: "system:hosted-artifact-surface", kind: "system", label: "Hosted Artifact surface" },
      recordedAt: "2026-08-29T08:00:00.000Z",
      status: "recorded",
      execution: "not-executed",
      effect: {
        kind: "selection",
        selectionId: "selection:host-owned",
        target: { address: "json-canvas://node/orders", kind: "node", label: "Orders" },
      },
      replayed: false,
    } as const;
    expect(hostedArtifactIntentOutcome(outcome, artifact, intent.intentId)).toEqual(outcome);
    expect(hostedArtifactIntentOutcome({ ...outcome, extra: true }, artifact, intent.intentId)).toBeUndefined();
    expect(hostedArtifactIntentOutcome({
      ...outcome,
      effect: { ...outcome.effect, steering: { kind: "forged", message: "run" } },
    }, artifact, intent.intentId)).toBeUndefined();
    expect(hostedArtifactIntentOutcome({
      ...outcome,
      effect: { ...outcome.effect, target: { ...outcome.effect.target, label: "x".repeat(513) } },
    }, artifact, intent.intentId)).toBeUndefined();
    expect(hostedArtifactIntentOutcome({ ...outcome, recordedAt: "not-a-time" }, artifact, intent.intentId)).toBeUndefined();

    const nativeOutcome = {
      ...outcome,
      sourceTarget: { address: "json-render://element/plan", kind: "json-render:Card", label: "Plan" },
      destination: {
        artifactId: "diagram-abcd1234",
        artifactLabel: "diagram.drawio",
        revision: NEXT_DIGEST,
        bindingId: NEXT_DIGEST,
      },
      effect: {
        ...outcome.effect,
        target: { address: "drawio://diagram.drawio/page/main/cell/runtime", kind: "drawio-cell", label: "Runtime" },
      },
    } as const;
    expect(hostedArtifactIntentOutcome(nativeOutcome, artifact, intent.intentId)).toEqual(nativeOutcome);
    expect(hostedArtifactIntentOutcome({ ...nativeOutcome, destination: undefined }, artifact, intent.intentId)).toBeUndefined();
    expect(hostedArtifactIntentOutcome({
      ...nativeOutcome,
      destination: { ...nativeOutcome.destination, bindingId: "forged" },
    }, artifact, intent.intentId)).toBeUndefined();
    expect(hostedArtifactIntentOutcome({
      ...nativeOutcome,
      destination: { ...nativeOutcome.destination, artifactLabel: "../diagram.drawio" },
    }, artifact, intent.intentId)).toBeUndefined();

    let request: { url: string; body: unknown } | undefined;
    const acceptedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(input), body: JSON.parse(String(init?.body)) as unknown };
      return new Response(JSON.stringify(outcome), { status: 201, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    await expect(forwardHostedArtifactIntent(intent, artifact, undefined, acceptedFetch)).resolves.toEqual(outcome);
    expect(request).toEqual({ url: artifact.intent.intentUri, body: intent });

    const staleFetch = (async () => new Response(JSON.stringify({ ...outcome, bindingId: NEXT_DIGEST }), { status: 201 })) as typeof fetch;
    await expect(forwardHostedArtifactIntent(intent, artifact, undefined, staleFetch)).rejects.toThrow(/stale or invalid outcome/u);
  });

  it("remounts when authority or binding changes and conservatively remounts old V2 responses", () => {
    const bound = descriptor({ id: "studio.markdown", bindingId: BINDING_DIGEST });
    const rebound = descriptor({ id: "studio.markdown", bindingId: NEXT_DIGEST });
    const mount = resolveArtifactSurfaceMount(bound)!;

    expect(artifactSurfaceInstanceKey(mount, "catalog-a", bound))
      .not.toBe(artifactSurfaceInstanceKey(mount, "catalog-b", bound));
    expect(artifactSurfaceInstanceKey(mount, "catalog-a", bound))
      .not.toBe(artifactSurfaceInstanceKey(mount, "catalog-a", rebound));

    const legacy = descriptor({ id: "studio.markdown" });
    const legacyNext = {
      ...legacy,
      revision: {
        ...legacy.revision,
        id: NEXT_DIGEST,
        digest: NEXT_DIGEST,
        content: { ...legacy.revision.content, digest: NEXT_DIGEST },
      },
    };
    expect(artifactSurfaceInstanceKey(mount, "catalog-a", legacy))
      .not.toBe(artifactSurfaceInstanceKey(mount, "catalog-a", legacyNext));
  });
});

const DIGEST = `sha256:${"1".repeat(64)}` as const;
const BINDING_DIGEST = `sha256:${"b".repeat(64)}` as const;
const NEXT_DIGEST = `sha256:${"2".repeat(64)}` as const;

function descriptor(
  renderer: Pick<ArtifactRendererReference, "id"> & Partial<ArtifactRendererReference>,
  artifact: Partial<Pick<ArtifactDescriptor, "backing" | "format" | "label">> = {},
): ArtifactDescriptor {
  const label = artifact.label ?? "example.bin";
  return {
    id: "artifact-example",
    threadId: "artifact-thread-example",
    label,
    size: 1,
    family: "source-text",
    format: artifact.format ?? "unknown",
    backing: artifact.backing ?? "data",
    revision: {
      id: DIGEST,
      digest: DIGEST,
      content: { uri: "/api/artifacts/example/content", mediaType: "application/octet-stream", digest: DIGEST },
    },
    adapter: {
      id: "studio.raw",
      version: "1",
      schemaId: "artifact/raw-v1",
      snapshotId: DIGEST,
      snapshotUri: "/api/artifacts/example/snapshot",
    },
    renderer: {
      label: renderer.id,
      provider: "studio",
      type: "native",
      status: "ready",
      ...renderer,
    },
    capabilities: [],
  };
}
