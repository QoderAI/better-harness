import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  isArtifactDataSnapshot,
  type ArtifactDescriptor,
  type XlsxArtifactPayload,
} from "../src/artifact-model.js";
import { describeArtifactCatalog, indexArtifactDirectory } from "../src/server/artifact-catalog.js";
import type { ArtifactEntry } from "../src/server/artifact-catalog.js";
import { resolveArtifactPlugin } from "../src/server/artifact-plugin-registry.js";
import { resetXlsxArtifactCache, XLSX_ARTIFACT_ADAPTER } from "../src/server/xlsx-artifact-adapter.js";
import { createXlsxFixture } from "./xlsx-fixture.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  resetXlsxArtifactCache();
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("XLSX ArtifactDataAdapter", () => {
  it("creates a revision-bound workbook snapshot with formulas, styles, merges, and shared strings", async () => {
    const { entry, descriptor } = await writeFixture();
    const snapshot = await XLSX_ARTIFACT_ADAPTER.adapt({ entry, descriptor });

    expect(isArtifactDataSnapshot(snapshot)).toBe(true);
    expect(snapshot).toMatchObject({
      artifactId: descriptor.id,
      revisionId: descriptor.revision.id,
      snapshotId: descriptor.adapter.snapshotId,
      adapter: { id: "studio.xlsx-ooxml", version: "1" },
      schemaId: "xlsx/v1",
    });
    const payload = snapshot.payload as XlsxArtifactPayload;
    expect(payload).toMatchObject({
      kind: "xlsx/v1",
      activeSheetIndex: 1,
      dateSystem: "1900",
      definedNamesPresent: true,
    });
    expect(payload.sheets.map((sheet) => sheet.label)).toEqual(["Summary", "Data"]);

    const summary = payload.sheets[0]!;
    expect(summary).toMatchObject({ rowCount: 4, columnCount: 2, mergedRanges: [{ ref: "A1:B1" }] });
    expect(summary.columns).toContainEqual({ index: 1, width: 24 });
    expect(summary.rows).toContainEqual({ index: 1, height: 30 });
    expect(summary.cells.find((cell) => cell.address === "A1")).toMatchObject({
      display: "Studio XLSX Fixture",
      style: { fill: "#17324D", color: "#FFFFFF", fontFamily: "Aptos Display", fontSizePoints: 16, bold: true, verticalAlignment: "center" },
    });
    expect(summary.cells.find((cell) => cell.address === "B3")).toMatchObject({
      value: 30,
      display: "30",
      formula: "SUM('Data'!B2:B3)",
    });
    expect(summary.cells.find((cell) => cell.address === "B4")).toMatchObject({ value: 0.75, display: "75.0%" });

    const data = payload.sheets[1]!;
    expect(data.cells.find((cell) => cell.address === "A2")).toMatchObject({ value: 46_257, display: "2026-08-23" });
    expect(data.cells.find((cell) => cell.address === "C2")).toMatchObject({ value: "Canvas TSX", display: "Canvas TSX" });
    expect(snapshot.structure).toEqual([
      expect.objectContaining({ address: "xlsx:sheet/1", label: "Summary", kind: "worksheet" }),
      expect.objectContaining({ address: "xlsx:sheet/2", label: "Data", kind: "worksheet" }),
    ]);
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({ code: "XLSX_BASELINE_RENDERER", level: "info" }));
  });

  it("keeps cache envelopes bound to the exact artifact and moves revisions when bytes change", async () => {
    const directory = await makeTempDirectory();
    const bytes = createXlsxFixture();
    await writeFile(join(directory, "first.xlsx"), bytes);
    await writeFile(join(directory, "second.xlsx"), bytes);
    const firstIndex = await indexArtifactDirectory(directory, { includeDigests: true });
    const firstCatalog = describeArtifactCatalog(firstIndex, (entry) => resolveArtifactPlugin(entry));
    const firstEntry = firstIndex.entries.find((entry) => entry.label === "first.xlsx")!;
    const secondEntry = firstIndex.entries.find((entry) => entry.label === "second.xlsx")!;
    const firstDescriptor = firstCatalog.artifacts.find((artifact) => artifact.label === "first.xlsx")!;
    const secondDescriptor = firstCatalog.artifacts.find((artifact) => artifact.label === "second.xlsx")!;

    const firstSnapshot = await XLSX_ARTIFACT_ADAPTER.adapt({ entry: firstEntry, descriptor: firstDescriptor });
    const secondSnapshot = await XLSX_ARTIFACT_ADAPTER.adapt({ entry: secondEntry, descriptor: secondDescriptor });
    expect(secondSnapshot.artifactId).toBe(secondDescriptor.id);
    expect(secondSnapshot.artifactId).not.toBe(firstSnapshot.artifactId);

    await writeFile(firstEntry.path, createXlsxFixture({ formulaResult: 31 }));
    const nextIndex = await indexArtifactDirectory(directory, { includeDigests: true });
    const nextDescriptor = describeArtifactCatalog(nextIndex, (entry) => resolveArtifactPlugin(entry)).artifacts
      .find((artifact) => artifact.label === "first.xlsx")!;
    const nextEntry = nextIndex.entries.find((entry) => entry.label === "first.xlsx")!;
    const nextSnapshot = await XLSX_ARTIFACT_ADAPTER.adapt({ entry: nextEntry, descriptor: nextDescriptor });

    expect(nextDescriptor.threadId).toBe(firstDescriptor.threadId);
    expect(nextDescriptor.revision.id).not.toBe(firstDescriptor.revision.id);
    expect(nextSnapshot.revisionId).not.toBe(firstSnapshot.revisionId);
    const nextPayload = nextSnapshot.payload as XlsxArtifactPayload;
    expect(nextPayload.sheets[0]!.cells.find((cell) => cell.address === "B3")?.value).toBe(31);
  });

  it("accepts a legal self-closing empty sharedStrings part", async () => {
    const directory = await makeTempDirectory();
    await writeFile(join(directory, "empty-strings.xlsx"), createXlsxFixture({ emptySharedStrings: true }));
    const index = await indexArtifactDirectory(directory, { includeDigests: true });
    const descriptor = describeArtifactCatalog(index, (entry) => resolveArtifactPlugin(entry)).artifacts[0]!;
    const snapshot = await XLSX_ARTIFACT_ADAPTER.adapt({ entry: index.entries[0]!, descriptor });
    const payload = snapshot.payload as XlsxArtifactPayload;
    expect(payload.sheets[1]!.cells.find((cell) => cell.address === "C2")?.display).toBe("Canvas TSX");
  });

  it("retains populated cells beyond the former 200-row preview window", async () => {
    const directory = await makeTempDirectory();
    await writeFile(join(directory, "large.xlsx"), createXlsxFixture({ farRow: 420 }));
    const index = await indexArtifactDirectory(directory, { includeDigests: true });
    const descriptor = describeArtifactCatalog(index, (entry) => resolveArtifactPlugin(entry)).artifacts[0]!;
    const snapshot = await XLSX_ARTIFACT_ADAPTER.adapt({ entry: index.entries[0]!, descriptor });
    const payload = snapshot.payload as XlsxArtifactPayload;
    expect(payload.sheets[0]).toMatchObject({ rowCount: 420 });
    expect(payload.sheets[0]!.cells.find((cell) => cell.address === "A420")).toMatchObject({ display: "Virtualized row" });
    expect(snapshot.diagnostics.some((diagnostic) => diagnostic.code === "XLSX_SHEET_TRUNCATED")).toBe(false);
  });

  it("rejects invalid ZIP, unsafe paths, XML entities, and a missing workbook target", async () => {
    await expectRejectedBytes(strToU8("not a zip archive"), /zip|archive|invalid|data/iu);
    await expectRejectedBytes(zipSync({ "../outside.xml": strToU8("escape") }), /unsafe entry path/u);

    const hostile = unzipSync(createXlsxFixture());
    hostile["xl/workbook.xml"] = strToU8(`<?xml version="1.0"?><!DOCTYPE workbook [<!ENTITY x "unsafe">]><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets>&x;</sheets></workbook>`);
    await expectRejectedBytes(zipSync(hostile), /external entities/u);
    await expectRejectedBytes(createXlsxFixture({ workbookRelationshipTarget: "xl/missing.xml" }), /package part is missing/u);
  });
});

async function writeFixture(): Promise<{ entry: ArtifactEntry; descriptor: ArtifactDescriptor }> {
  const directory = await makeTempDirectory();
  await writeFile(join(directory, "workbook.xlsx"), createXlsxFixture());
  const index = await indexArtifactDirectory(directory, { includeDigests: true });
  const descriptor = describeArtifactCatalog(index, (entry) => resolveArtifactPlugin(entry)).artifacts[0]!;
  return { entry: index.entries[0]!, descriptor };
}

async function makeTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "studio-xlsx-adapter-"));
  tempDirectories.push(directory);
  return directory;
}

async function expectRejectedBytes(bytes: Uint8Array, error: RegExp): Promise<void> {
  const directory = await makeTempDirectory();
  await writeFile(join(directory, "hostile.xlsx"), bytes);
  const index = await indexArtifactDirectory(directory, { includeDigests: true });
  const descriptor = describeArtifactCatalog(index, (entry) => resolveArtifactPlugin(entry)).artifacts[0]!;
  await expect(XLSX_ARTIFACT_ADAPTER.adapt({ entry: index.entries[0]!, descriptor })).rejects.toThrow(error);
}
