import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isArtifactCatalogResponse,
  isArtifactDataSnapshot,
  type XlsxArtifactPayload,
} from "../src/artifact-model.js";
import { startHarnessStudioServer, type StartedHarnessStudioServer } from "../src/server/server.js";
import { createXlsxFixture } from "./xlsx-fixture.js";

let server: StartedHarnessStudioServer | undefined;
const tempDirectories: string[] = [];

afterEach(async () => {
  await server?.close();
  server = undefined;
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("XLSX artifact HTTP boundary", () => {
  it("serves typed revision snapshots and invalidates stale snapshot URIs", async () => {
    const appDir = await makeTempDirectory("studio-app-");
    const artifactDirectory = await makeTempDirectory("studio-xlsx-http-");
    const canvasViewerRoot = await makeTempDirectory("studio-empty-canvas-viewers-");
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>fixture</title>");
    await writeFile(join(artifactDirectory, "workbook.xlsx"), createXlsxFixture());
    server = await startHarnessStudioServer({ appDir, artifactDirectory, canvasViewerRoot });

    const catalogValue: unknown = await (await fetch(`${server.url}/api/artifacts`)).json();
    expect(isArtifactCatalogResponse(catalogValue)).toBe(true);
    if (!isArtifactCatalogResponse(catalogValue)) throw new Error("expected an Artifact Catalog V2 response");
    const descriptor = catalogValue.artifacts[0]!;
    expect(descriptor).toMatchObject({
      format: "xlsx",
      family: "documents",
      backing: "data",
      adapter: { id: "studio.xlsx-ooxml", schemaId: "xlsx/v1" },
      renderer: { id: "studio.xlsx-grid", status: "ready" },
    });

    const snapshotResponse = await fetch(`${server.url}${descriptor.adapter.snapshotUri}`);
    expect(snapshotResponse.status).toBe(200);
    expect(snapshotResponse.headers.get("cache-control")).toBe("no-store");
    const snapshotValue: unknown = await snapshotResponse.json();
    expect(isArtifactDataSnapshot(snapshotValue)).toBe(true);
    if (!isArtifactDataSnapshot(snapshotValue)) throw new Error("expected an ArtifactDataSnapshot");
    expect(snapshotValue.revisionId).toBe(descriptor.revision.id);
    expect(snapshotValue.snapshotId).toBe(descriptor.adapter.snapshotId);
    expect(snapshotValue.resources).toHaveLength(0);
    const payload = snapshotValue.payload as XlsxArtifactPayload;
    expect(payload.sheets.map((sheet) => sheet.label)).toEqual(["Summary", "Data"]);

    await writeFile(join(artifactDirectory, "workbook.xlsx"), createXlsxFixture({ formulaResult: 31 }));
    const nextCatalog: unknown = await (await fetch(`${server.url}/api/artifacts`)).json();
    if (!isArtifactCatalogResponse(nextCatalog)) throw new Error("expected an Artifact Catalog V2 response");
    const nextDescriptor = nextCatalog.artifacts[0]!;
    expect(nextDescriptor.threadId).toBe(descriptor.threadId);
    expect(nextDescriptor.revision.id).not.toBe(descriptor.revision.id);
    expect((await fetch(`${server.url}${descriptor.adapter.snapshotUri}`)).status).toBe(409);
  });
});

async function makeTempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}
