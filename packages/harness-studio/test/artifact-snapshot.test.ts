import { describe, expect, it } from "vitest";
import { isArtifactDataSnapshot, type ArtifactDataSnapshot, type ArtifactDescriptor, XLSX_ARTIFACT_PREVIEW_LIMITS } from "../src/artifact-model.js";
import { isArtifactSnapshotFor } from "../src/app/artifacts/useArtifactSnapshot.js";

const DIGEST_A = `sha256:${"1".repeat(64)}` as const;
const DIGEST_B = `sha256:${"2".repeat(64)}` as const;

describe("Artifact snapshot loading contract", () => {
  it("binds payload dispatch to the exact artifact, revision, snapshot, and adapter identity", () => {
    const artifact = descriptor();
    const snapshot = docxSnapshot();
    expect(isArtifactSnapshotFor(snapshot, artifact, "docx/v1")).toBe(true);

    for (const candidate of [
      { ...snapshot, artifactId: "another-artifact" },
      { ...snapshot, revisionId: DIGEST_B },
      { ...snapshot, snapshotId: DIGEST_A },
      { ...snapshot, adapter: { ...snapshot.adapter, id: "another.adapter" } },
      { ...snapshot, adapter: { ...snapshot.adapter, version: "2" } },
      { ...snapshot, schemaId: "docx/v2" },
      { ...snapshot, payload: { kind: "markdown/v1", blocks: [] } },
      { ...snapshot, payload: { kind: "docx/v1" } },
      { ...snapshot, structure: [{ id: "missing-required-fields" }] },
    ]) {
      expect(isArtifactSnapshotFor(candidate, artifact, "docx/v1")).toBe(false);
    }
  });

  it("rejects XLSX payload bounds that could make the grid allocate or loop without limit", () => {
    const snapshot = docxSnapshot();
    const worksheet = {
      id: "sheet-1",
      label: "Sheet 1",
      address: "xlsx:sheet/1",
      rowCount: 1,
      columnCount: 1,
      cells: [],
      mergedRanges: [],
      columns: [],
      rows: [],
    };
    const xlsx = {
      ...snapshot,
      payload: {
        kind: "xlsx/v1",
        activeSheetIndex: 0,
        dateSystem: "1900",
        definedNamesPresent: false,
        sheets: [worksheet],
      },
    };
    expect(isArtifactDataSnapshot(xlsx)).toBe(true);
    expect(isArtifactDataSnapshot({
      ...xlsx,
      payload: { ...xlsx.payload, sheets: [{ ...worksheet, rowCount: XLSX_ARTIFACT_PREVIEW_LIMITS.rowsPerSheet + 1 }] },
    })).toBe(false);
    expect(isArtifactDataSnapshot({
      ...xlsx,
      payload: {
        ...xlsx.payload,
        sheets: [{
          ...worksheet,
          mergedRanges: [{ ref: "A1:A2", startRow: 1, startColumn: 1, endRow: Number.MAX_SAFE_INTEGER, endColumn: 1 }],
        }],
      },
    })).toBe(false);
    expect(isArtifactDataSnapshot({
      ...xlsx,
      payload: {
        ...xlsx.payload,
        sheets: [{
          ...worksheet,
          mergedRanges: [{ ref: "A2:A1", startRow: 2, startColumn: 1, endRow: 1, endColumn: 1 }],
        }],
      },
    })).toBe(false);
  });

  it("rejects PDF page counts, order, and geometry that could over-allocate canvas memory", () => {
    const snapshot = docxSnapshot();
    const page = { index: 1, width: 612, height: 792, rotation: 0 };
    const pdf = {
      ...snapshot,
      schemaId: "pdf/v1",
      payload: { kind: "pdf/v1", resourceId: "document", pageCount: 1, pages: [page] },
    };
    expect(isArtifactDataSnapshot(pdf)).toBe(true);
    expect(isArtifactDataSnapshot({
      ...pdf,
      payload: { ...pdf.payload, pages: [{ ...page, index: 2 }] },
    })).toBe(false);
    expect(isArtifactDataSnapshot({
      ...pdf,
      payload: { ...pdf.payload, pages: [{ ...page, width: 10_001 }] },
    })).toBe(false);
    expect(isArtifactDataSnapshot({
      ...pdf,
      payload: { ...pdf.payload, pages: [{ ...page, width: 6_000, height: 6_000 }] },
    })).toBe(false);
  });
});

function descriptor(): ArtifactDescriptor {
  return {
    id: "artifact-document",
    threadId: "artifact-thread-document",
    label: "document.docx",
    size: 1,
    family: "documents",
    format: "docx",
    backing: "data",
    revision: {
      id: DIGEST_A,
      digest: DIGEST_A,
      content: {
        uri: "/api/artifacts/document/revisions/111/content",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        digest: DIGEST_A,
      },
    },
    adapter: {
      id: "studio.docx-ooxml",
      version: "1",
      schemaId: "docx/v1",
      snapshotId: DIGEST_B,
      snapshotUri: "/api/artifacts/document/revisions/111/snapshot",
    },
    renderer: {
      id: "studio.docx-dom",
      label: "Studio DOCX",
      provider: "studio",
      type: "native",
      status: "ready",
    },
    capabilities: ["navigate", "outline", "select", "zoom"],
  };
}

function docxSnapshot(): ArtifactDataSnapshot {
  return {
    kind: "ArtifactDataSnapshotV1",
    artifactId: "artifact-document",
    revisionId: DIGEST_A,
    snapshotId: DIGEST_B,
    adapter: { id: "studio.docx-ooxml", version: "1" },
    schemaId: "docx/v1",
    summary: { label: "document.docx", family: "documents", format: "docx" },
    structure: [],
    semanticIndex: [],
    resources: [],
    diagnostics: [],
    payload: { kind: "docx/v1", blocks: [], headersPresent: false, footersPresent: false },
  };
}
