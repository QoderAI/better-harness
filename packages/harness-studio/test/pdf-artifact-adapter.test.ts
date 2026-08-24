import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describeArtifactCatalog, indexArtifactDirectory } from "../src/server/artifact-catalog.js";
import { resolveArtifactPlugin } from "../src/server/artifact-plugin-registry.js";
import { PDF_ARTIFACT_ADAPTER, resetPdfArtifactCache } from "../src/server/pdf-artifact-adapter.js";
import { createPdfFixture } from "./pdf-fixture.js";

afterEach(() => resetPdfArtifactCache());

describe("PDF Artifact adapter", () => {
  it("projects page geometry and serves the exact revision bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pdf-artifact-"));
    const path = join(directory, "fixture.pdf");
    const bytes = createPdfFixture();
    await writeFile(path, bytes);
    const index = await indexArtifactDirectory(directory, { includeDigests: true });
    const descriptor = describeArtifactCatalog(index, (entry) => resolveArtifactPlugin(entry)).artifacts[0]!;
    const entry = index.entries[0]!;

    expect(descriptor).toMatchObject({
      family: "documents",
      format: "pdf",
      adapter: { id: "studio.pdf-pdfjs", version: "1", schemaId: "pdf/v1" },
      renderer: { id: "studio.pdf-canvas", type: "native", status: "ready" },
    });
    const snapshot = await PDF_ARTIFACT_ADAPTER.adapt({ entry, descriptor });
    expect(snapshot).toMatchObject({
      payload: {
        kind: "pdf/v1",
        pageCount: 2,
        pages: [
          { index: 1, width: 300, height: 420, rotation: 0 },
          { index: 2, width: 420, height: 300, rotation: 0 },
        ],
      },
      resources: [{ id: "document", mediaType: "application/pdf", size: bytes.byteLength }],
    });
    expect((await PDF_ARTIFACT_ADAPTER.readResource?.({ entry, descriptor }, "document"))?.bytes).toEqual(bytes);
    expect(await PDF_ARTIFACT_ADAPTER.readResource?.({ entry, descriptor }, "../document")).toBeUndefined();
  });

  it("fails closed when bytes drift after cataloging", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pdf-artifact-drift-"));
    const path = join(directory, "fixture.pdf");
    const bytes = createPdfFixture();
    await writeFile(path, bytes);
    const index = await indexArtifactDirectory(directory, { includeDigests: true });
    const descriptor = describeArtifactCatalog(index, (entry) => resolveArtifactPlugin(entry)).artifacts[0]!;
    await writeFile(path, new Uint8Array([...bytes, 0x20]));
    await expect(PDF_ARTIFACT_ADAPTER.adapt({ entry: index.entries[0]!, descriptor }))
      .rejects.toThrow("no longer match the requested artifact revision");
  });

  it("fails closed before exposing a page geometry that could over-allocate a canvas", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pdf-artifact-geometry-"));
    const path = join(directory, "oversized-page.pdf");
    const bytes = createPdfFixture({ firstPageWidth: 10_001 });
    await writeFile(path, bytes);
    const index = await indexArtifactDirectory(directory, { includeDigests: true });
    const descriptor = describeArtifactCatalog(index, (entry) => resolveArtifactPlugin(entry)).artifacts[0]!;
    await expect(PDF_ARTIFACT_ADAPTER.adapt({ entry: index.entries[0]!, descriptor }))
      .rejects.toThrow("page 1 exceeds the page geometry limit");
  });

  it("uses the exact source digest in the public revision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pdf-artifact-digest-"));
    const bytes = createPdfFixture();
    await writeFile(join(directory, "fixture.pdf"), bytes);
    const index = await indexArtifactDirectory(directory, { includeDigests: true });
    expect(index.entries[0]?.digest).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  });
});
