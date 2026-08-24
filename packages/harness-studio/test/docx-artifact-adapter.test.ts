import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  isArtifactDataSnapshot,
  type ArtifactDescriptor,
  type DocxArtifactPayload,
  type DocxParagraph,
  type DocxTable,
} from "../src/artifact-model.js";
import { describeArtifactCatalog, indexArtifactDirectory } from "../src/server/artifact-catalog.js";
import type { ArtifactEntry } from "../src/server/artifact-catalog.js";
import { DOCX_ARTIFACT_ADAPTER, resetDocxArtifactCache } from "../src/server/docx-artifact-adapter.js";
import { resolveArtifactPlugin } from "../src/server/artifact-plugin-registry.js";
import { createDocxFixture, TINY_PNG } from "./docx-fixture.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  resetDocxArtifactCache();
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("DOCX ArtifactDataAdapter", () => {
  it("creates a revision-bound body snapshot with styles, tables, media, and honest diagnostics", async () => {
    const { entry, descriptor } = await writeFixture("01");

    const snapshot = await DOCX_ARTIFACT_ADAPTER.adapt({ entry, descriptor });

    expect(isArtifactDataSnapshot(snapshot)).toBe(true);
    expect(snapshot).toMatchObject({
      artifactId: descriptor.id,
      revisionId: descriptor.revision.id,
      snapshotId: descriptor.adapter.snapshotId,
      adapter: { id: "studio.docx-ooxml", version: "1" },
      schemaId: "docx/v1",
    });
    const payload = snapshot.payload as DocxArtifactPayload;
    expect(payload).toMatchObject({ kind: "docx/v1", headersPresent: true, footersPresent: true });
    expect(payload.blocks).toHaveLength(2);

    const paragraph = payload.blocks[0] as DocxParagraph;
    expect(paragraph).toMatchObject({
      kind: "paragraph",
      id: "paragraph-1",
      address: "docx:paragraph/1",
      styleId: "Heading1",
      headingLevel: 1,
      alignment: "center",
      numbering: { numId: "7", level: 0 },
    });
    expect(paragraph.inlines[0]).toMatchObject({
      kind: "text",
      text: "01 \tTabbed\nLine",
      fontFamily: "Aptos",
      fontSizePoints: 14,
      color: "#123ABC",
      bold: true,
      italic: true,
      underline: true,
      strike: true,
    });
    expect(paragraph.inlines[1]).toMatchObject({
      kind: "image",
      alt: "fixture alt",
      widthEmu: 914_400,
      heightEmu: 457_200,
    });

    const table = payload.blocks[1] as DocxTable;
    expect(table).toMatchObject({
      kind: "table",
      label: "Table 1",
      rows: [{ cells: [
        { paragraphs: [{ label: "Cell A" }] },
        { paragraphs: [{ label: "Cell B" }] },
      ] }],
    });
    expect(snapshot.structure).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: "docx:paragraph/1", kind: "paragraph" }),
      expect.objectContaining({ address: "docx:table/1", kind: "table" }),
    ]));
    expect(snapshot.semanticIndex.map((item) => item.address)).toEqual(expect.arrayContaining([
      "docx:paragraph/1",
      "docx:table/1",
      "docx:paragraph/2",
      "docx:paragraph/3",
    ]));
    expect(snapshot.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DOCX_HEADER_FOOTER_PRESENT", level: "info" }),
      expect.objectContaining({ code: "DOCX_BASELINE_RENDERER", level: "info" }),
    ]));

    const resource = snapshot.resources[0]!;
    expect(resource).toMatchObject({ mediaType: "image/png", size: TINY_PNG.length });
    expect(resource.uri).toBe(`/api/artifacts/${descriptor.id}/revisions/${descriptor.revision.digest.slice(7)}/resources/${resource.id}`);
    expect(await DOCX_ARTIFACT_ADAPTER.readResource!({ entry, descriptor }, resource.id)).toMatchObject({
      mediaType: "image/png",
      label: "image1.png",
    });
    expect((await DOCX_ARTIFACT_ADAPTER.readResource!({ entry, descriptor }, resource.id))?.bytes).toEqual(TINY_PNG);
    expect(await DOCX_ARTIFACT_ADAPTER.readResource!({ entry, descriptor }, "../image1")).toBeUndefined();
  });

  it("keeps cache envelopes bound to the exact artifact and moves revisions when bytes change", async () => {
    const directory = await makeTempDirectory();
    const bytes = createDocxFixture("same");
    await writeFile(join(directory, "first.docx"), bytes);
    await writeFile(join(directory, "second.docx"), bytes);
    const firstIndex = await indexArtifactDirectory(directory, { includeDigests: true });
    const firstCatalog = describeArtifactCatalog(firstIndex, (entry) => resolveArtifactPlugin(entry));
    const firstEntry = firstIndex.entries.find((entry) => entry.label === "first.docx")!;
    const secondEntry = firstIndex.entries.find((entry) => entry.label === "second.docx")!;
    const firstDescriptor = firstCatalog.artifacts.find((artifact) => artifact.label === "first.docx")!;
    const secondDescriptor = firstCatalog.artifacts.find((artifact) => artifact.label === "second.docx")!;

    const firstSnapshot = await DOCX_ARTIFACT_ADAPTER.adapt({ entry: firstEntry, descriptor: firstDescriptor });
    const secondSnapshot = await DOCX_ARTIFACT_ADAPTER.adapt({ entry: secondEntry, descriptor: secondDescriptor });
    expect(secondSnapshot.artifactId).toBe(secondDescriptor.id);
    expect(secondSnapshot.artifactId).not.toBe(firstSnapshot.artifactId);
    expect(secondSnapshot.snapshotId).toBe(secondDescriptor.adapter.snapshotId);

    await writeFile(firstEntry.path, createDocxFixture("changed"));
    const nextIndex = await indexArtifactDirectory(directory, { includeDigests: true });
    const nextDescriptor = describeArtifactCatalog(nextIndex, (entry) => resolveArtifactPlugin(entry)).artifacts
      .find((artifact) => artifact.label === "first.docx")!;
    const nextEntry = nextIndex.entries.find((entry) => entry.label === "first.docx")!;
    const nextSnapshot = await DOCX_ARTIFACT_ADAPTER.adapt({ entry: nextEntry, descriptor: nextDescriptor });

    expect(nextDescriptor.threadId).toBe(firstDescriptor.threadId);
    expect(nextDescriptor.id).toBe(firstDescriptor.id);
    expect(nextDescriptor.revision.id).not.toBe(firstDescriptor.revision.id);
    expect(nextDescriptor.adapter.snapshotId).not.toBe(firstDescriptor.adapter.snapshotId);
    expect(nextSnapshot.revisionId).not.toBe(firstSnapshot.revisionId);
    expect(((nextSnapshot.payload as DocxArtifactPayload).blocks[0] as DocxParagraph).inlines[0]).toMatchObject({
      text: "changed \tTabbed\nLine",
    });
  });

  it("rejects invalid ZIP, unsafe paths, oversized entries, and a missing main relationship target", async () => {
    await expectRejectedBytes(strToU8("not a zip archive"), /zip|archive|invalid|data/iu);
    await expectRejectedBytes(zipSync({ "../outside.xml": strToU8("escape") }), /unsafe entry path/u);
    await expectRejectedBytes(
      zipSync({ "word/media/huge.bin": new Uint8Array(32 * 1024 * 1024 + 1) }, { level: 9 }),
      /entry exceeds the expansion limit/u,
    );
    await expectRejectedBytes(
      createDocxFixture("broken", TINY_PNG, { documentRelationshipTarget: "word/missing.xml" }),
      /required part 'word\/missing\.xml' is missing/u,
    );
  });

  it("rejects XML entity declarations and diagnoses an unresolved embedded image relationship", async () => {
    const hostile = unzipSync(createDocxFixture("safe"));
    hostile["word/document.xml"] = strToU8(`<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY x "unsafe">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>`);
    await expectRejectedBytes(zipSync(hostile), /declarations and entities are not supported/u);

    const { entry, descriptor } = await writeFixture("broken image", {
      imageRelationshipTarget: "media/missing.png",
    });
    const snapshot = await DOCX_ARTIFACT_ADAPTER.adapt({ entry, descriptor });
    expect(snapshot.resources).toHaveLength(0);
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({
      code: "DOCX_IMAGE_MISSING",
      level: "warning",
      address: "docx:paragraph/1",
    }));
  });
});

async function writeFixture(
  text: string,
  options: Parameters<typeof createDocxFixture>[2] = {},
): Promise<{ directory: string; entry: ArtifactEntry; descriptor: ArtifactDescriptor }> {
  const directory = await makeTempDirectory();
  await writeFile(join(directory, "document.docx"), createDocxFixture(text, TINY_PNG, options));
  const index = await indexArtifactDirectory(directory, { includeDigests: true });
  const descriptor = describeArtifactCatalog(index, (entry) => resolveArtifactPlugin(entry)).artifacts[0]!;
  return { directory, entry: index.entries[0]!, descriptor };
}

async function makeTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "studio-docx-adapter-"));
  tempDirectories.push(directory);
  return directory;
}

async function expectRejectedBytes(bytes: Uint8Array, error: RegExp): Promise<void> {
  const directory = await makeTempDirectory();
  await writeFile(join(directory, "hostile.docx"), bytes);
  const index = await indexArtifactDirectory(directory, { includeDigests: true });
  const descriptor = describeArtifactCatalog(index, (entry) => resolveArtifactPlugin(entry)).artifacts[0]!;
  await expect(DOCX_ARTIFACT_ADAPTER.adapt({ entry: index.entries[0]!, descriptor })).rejects.toThrow(error);
}
