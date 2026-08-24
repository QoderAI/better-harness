import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtifactDescriptor, ArtifactRendererReference } from "../src/artifact-model.js";
import {
  ARTIFACT_SURFACE_MOUNTS,
  ArtifactView,
  artifactSurfaceInstanceKey,
  normalizeArtifactSurfaceKind,
  resolveArtifactSurfaceMount,
} from "../src/app/ArtifactView.js";

describe("Artifact View surface registry", () => {
  it("keeps one stable ordered composition boundary for every view family", () => {
    expect(ARTIFACT_SURFACE_MOUNTS.map((mount) => mount.id)).toEqual([
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
    expect(renderToStaticMarkup(createElement(ArtifactView, { authorityId: "catalog-a", artifact, liveGeneration: 0 })))
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
    const markup = renderToStaticMarkup(createElement(ArtifactView, { authorityId: "catalog-a", artifact: unavailable, liveGeneration: 0 }));
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
