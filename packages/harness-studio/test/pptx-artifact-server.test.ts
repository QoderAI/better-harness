import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isArtifactCatalogResponse, isArtifactDataSnapshot, type PptxArtifactPayload } from "../src/artifact-model.js";
import { startHarnessStudioServer, type StartedHarnessStudioServer } from "../src/server/server.js";
import { createPptxFixture, TINY_PNG } from "./pptx-fixture.js";

/** A second 1x1 PNG, so a replaced picture keeps its package path. */
const OTHER_PNG = new Uint8Array([...TINY_PNG.slice(0, TINY_PNG.length - 1), (TINY_PNG.at(-1)! ^ 0xff)]);

let server: StartedHarnessStudioServer | undefined;
const tempDirectories: string[] = [];

afterEach(async () => {
  await server?.close();
  server = undefined;
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("PPTX artifact HTTP boundary", () => {
  it("serves typed snapshots and only snapshot-addressed embedded resources", async () => {
    const appDir = await makeTempDirectory("studio-app-");
    const artifactDirectory = await makeTempDirectory("studio-pptx-http-");
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>fixture</title>");
    await writeFile(join(artifactDirectory, "deck.pptx"), createPptxFixture("01"));
    server = await startHarnessStudioServer({ appDir, artifactDirectory });

    const catalogValue: unknown = await (await fetch(`${server.url}/api/artifacts`)).json();
    expect(isArtifactCatalogResponse(catalogValue)).toBe(true);
    if (!isArtifactCatalogResponse(catalogValue)) throw new Error("expected an Artifact Catalog V2 response");
    const descriptor = catalogValue.artifacts[0]!;
    expect(descriptor).toMatchObject({
      format: "pptx",
      family: "documents",
      backing: "data",
      adapter: { id: "studio.pptx-ooxml", schemaId: "pptx/v1" },
      renderer: { id: "studio.pptx-dom", status: "ready" },
    });

    const snapshotResponse = await fetch(`${server.url}${descriptor.adapter.snapshotUri}`);
    expect(snapshotResponse.status).toBe(200);
    expect(snapshotResponse.headers.get("cache-control")).toBe("no-store");
    const snapshotValue: unknown = await snapshotResponse.json();
    expect(isArtifactDataSnapshot(snapshotValue)).toBe(true);
    if (!isArtifactDataSnapshot(snapshotValue)) throw new Error("expected an ArtifactDataSnapshot");
    expect(snapshotValue.revisionId).toBe(descriptor.revision.id);
    expect(snapshotValue.snapshotId).toBe(descriptor.adapter.snapshotId);
    expect(JSON.stringify(snapshotValue)).not.toContain("/Users/alice");
    expect((snapshotValue.payload as PptxArtifactPayload).slides[0]?.notesText).toBe("Source <local-path>/secret.md");

    const resource = snapshotValue.resources[0]!;
    const resourceResponse = await fetch(`${server.url}${resource.uri}`);
    expect(resourceResponse.status).toBe(200);
    expect(resourceResponse.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await resourceResponse.arrayBuffer())).toEqual(TINY_PNG);
    const revisionBase = `/api/artifacts/${descriptor.id}/revisions/${descriptor.revision.digest.slice(7)}`;
    expect(resource.uri).toBe(`${revisionBase}/resources/${resource.id}`);
    // Media is addressed by its bytes, so an immutable cache entry cannot outlive
    // the picture it describes.
    expect(resource.id).toBe(`media-${createHash("sha256").update(TINY_PNG).digest("hex").slice(0, 24)}`);
    expect(resourceResponse.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect((await fetch(`${server.url}${revisionBase}/resources/not-in-the-snapshot`)).status).toBe(404);
    expect((await fetch(`${server.url}${revisionBase}/resources/%E0%A4%A`)).status).toBe(400);

    // Replacing the picture while keeping its package path must produce a new
    // resource URL rather than reusing the cached one.
    await writeFile(join(artifactDirectory, "deck.pptx"), createPptxFixture("02", OTHER_PNG));
    const nextCatalog: unknown = await (await fetch(`${server.url}/api/artifacts`)).json();
    if (!isArtifactCatalogResponse(nextCatalog)) throw new Error("expected an Artifact Catalog V2 response");
    const nextDescriptor = nextCatalog.artifacts[0]!;
    expect(nextDescriptor.threadId).toBe(descriptor.threadId);
    const nextSnapshot: unknown = await (await fetch(`${server.url}${nextDescriptor.adapter.snapshotUri}`)).json();
    if (!isArtifactDataSnapshot(nextSnapshot)) throw new Error("expected an ArtifactDataSnapshot");
    expect(nextSnapshot.resources[0]!.id).not.toBe(resource.id);
    expect(nextSnapshot.resources[0]!.uri).not.toBe(resource.uri);
  });
});

async function makeTempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}
