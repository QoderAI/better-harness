import { link, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  artifactIdForLabel,
  assertArtifactId,
  ArtifactCatalogContractError,
  artifactSurfaceBindingId,
  confineToRoot,
  describeArtifactCatalog,
  findArtifact,
  indexArtifactDirectory,
  resetArtifactDigestCache,
  resolveArtifactFormatCode,
  resolveArtifactMediaType,
  resolveArtifactKind,
} from "../src/server/artifacts/registry/artifact-catalog.js";
import { isArtifactCatalogResponse } from "../src/contracts/artifact.js";
import type { ArtifactEntry } from "../src/server/artifacts/registry/artifact-catalog.js";
import type { ArtifactPluginResolution } from "../src/contracts/artifact.js";
import { resolveArtifactPlugin } from "../src/server/artifacts/registry/artifact-plugin-registry.js";

const fixtures = fileURLToPath(new URL("./fixtures/artifacts/", import.meta.url));
const presentationFor = (entry: ArtifactEntry) => resolveArtifactPlugin(entry);
const idOf = (label: string) => artifactIdForLabel(label);

describe("resolveArtifactKind", () => {
  it("maps known extensions to their renderer tier", () => {
    expect(resolveArtifactKind("report.tsx")).toBe("code");
    expect(resolveArtifactKind("chart.jsx")).toBe("code");
    expect(resolveArtifactKind("fix.patch")).toBe("diff");
    expect(resolveArtifactKind("verdict.json")).toBe("json");
    expect(resolveArtifactKind("diagram.svg")).toBe("svg");
    expect(resolveArtifactKind("diagram.mmd")).toBe("mermaid");
    expect(resolveArtifactKind("diagram.mermaid")).toBe("mermaid");
    expect(resolveArtifactKind("notes.md")).toBe("markdown");
    expect(resolveArtifactKind("notes.txt")).toBe("text");
  });

  it("is case-insensitive on the extension", () => {
    expect(resolveArtifactKind("Report.TSX")).toBe("code");
  });

  it("gives provider-hosted Canvas TSX a dedicated server-side format", () => {
    expect(resolveArtifactFormatCode("artifact-manifest-demo.canvas.tsx")).toBe("cursor-canvas-tsx");
    expect(resolveArtifactFormatCode("ARTIFACT-MANIFEST-DEMO.CANVAS.TSX")).toBe("cursor-canvas-tsx");
    expect(resolveArtifactFormatCode("ordinary.tsx")).toBe("tsx");
    expect(resolveArtifactKind("artifact-manifest-demo.canvas.tsx")).toBe("code");
  });

  it("classifies native Office adapters without guessing unknown binaries", () => {
    expect(resolveArtifactKind("document.docx")).toBe("docx");
    expect(resolveArtifactKind("document.pdf")).toBe("pdf");
    expect(resolveArtifactKind("deck.pptx")).toBe("pptx");
    expect(resolveArtifactKind("workbook.xlsx")).toBe("xlsx");
    expect(resolveArtifactKind("archive.bin")).toBe("unknown");
    expect(resolveArtifactKind("noextension")).toBe("unknown");
  });
});

describe("resolveArtifactMediaType", () => {
  it("keeps artifact references format-aware without claiming a renderer", () => {
    expect(resolveArtifactMediaType("deck.pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(resolveArtifactMediaType("workbook.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(resolveArtifactMediaType("report.pdf")).toBe("application/pdf");
    expect(resolveArtifactMediaType("motion.lottie")).toBe("application/zip");
    expect(resolveArtifactMediaType("script.mjs")).toBe("text/javascript; charset=utf-8");
    expect(resolveArtifactMediaType("archive.bin")).toBe("application/octet-stream");
  });
});

describe("assertArtifactId", () => {
  it("returns opaque ids unchanged", () => {
    expect(assertArtifactId("tool-mix")).toBe("tool-mix");
    expect(assertArtifactId("run_42")).toBe("run_42");
  });

  it("rejects path-shaped and traversal input", () => {
    for (const candidate of ["../secret", "a/b", "/etc/passwd", "..", "a.b", "", "a b"]) {
      expect(() => assertArtifactId(candidate)).toThrow(/Artifact id must match/u);
    }
  });

  it("rejects non-string input", () => {
    expect(() => assertArtifactId(undefined)).toThrow(/Artifact id must match/u);
    expect(() => assertArtifactId(42)).toThrow(/Artifact id must match/u);
  });
});

describe("confineToRoot", () => {
  it("resolves names inside the root", () => {
    expect(confineToRoot("/srv/artifacts", "a.tsx")).toBe(resolve("/srv/artifacts", "a.tsx"));
  });

  it("rejects escapes regardless of separator style", () => {
    expect(() => confineToRoot("/srv/artifacts", "../outside.tsx")).toThrow(/escapes the artifact directory/u);
    expect(() => confineToRoot("/srv/artifacts", "nested/../../outside.tsx")).toThrow(
      /escapes the artifact directory/u,
    );
  });

  it("rejects a sibling directory sharing the root's prefix", () => {
    expect(() => confineToRoot("/srv/artifacts", "../artifacts-evil/x.tsx")).toThrow(
      /escapes the artifact directory/u,
    );
  });
});

describe("indexArtifactDirectory", () => {
  it("indexes fixture files with opaque ids and real sizes", async () => {
    const index = await indexArtifactDirectory(fixtures);
    const toolMix = findArtifact(index.entries, idOf("tool-mix.tsx"));
    expect(toolMix).toBeDefined();
    expect(toolMix?.kind).toBe("code");
    expect(toolMix?.label).toBe("tool-mix.tsx");
    expect(toolMix?.size).toBeGreaterThan(0);
    for (const entry of index.entries) {
      expect(() => assertArtifactId(entry.id)).not.toThrow();
    }
  });

  it("offers bounded unknown text as Source while leaving binary bytes unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artifact-sniff-"));
    await writeFile(join(directory, "build.transcript"), "step one\nstep two\n", "utf8");
    await writeFile(join(directory, "payload.custom"), Buffer.from([0x50, 0x4b, 0x00, 0x03, 0x04]));

    const index = await indexArtifactDirectory(directory, { includeDigests: true });
    const transcript = index.entries.find((entry) => entry.label === "build.transcript")!;
    const payload = index.entries.find((entry) => entry.label === "payload.custom")!;
    expect(transcript.kind).toBe("text");
    expect(resolveArtifactPlugin(transcript)).toMatchObject({
      backing: "data",
      renderer: { id: "studio.text", status: "ready" },
    });
    expect(resolveArtifactMediaType(transcript.label, transcript.kind)).toBe("text/plain; charset=utf-8");
    expect(payload.kind).toBe("unknown");
    expect(resolveArtifactPlugin(payload)).toMatchObject({
      renderer: { id: "studio.unavailable", reason: expect.stringMatching(/Binary artifacts/u) },
    });
  });

  it("keeps ids and thread identity independent of what else the directory holds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artifact-catalog-"));
    await writeFile(join(directory, "report.md"), "one", "utf8");
    await writeFile(join(directory, "report.txt"), "two", "utf8");
    const before = await indexArtifactDirectory(directory);

    // A sibling sorting ahead of both files must not renumber either of them:
    // an id handed out earlier is dereferenced by a later request, so drifting
    // ids would serve one artifact's bytes under another artifact's handle.
    await writeFile(join(directory, "report-2.json"), "{}", "utf8");
    const after = await indexArtifactDirectory(directory);

    for (const label of ["report.md", "report.txt"]) {
      const first = before.entries.find((entry) => entry.label === label)!;
      const second = after.entries.find((entry) => entry.label === label)!;
      expect(second.id).toBe(first.id);
      expect(second.threadId).toBe(first.threadId);
    }
    expect(new Set(after.entries.map((entry) => entry.id)).size).toBe(after.entries.length);
  });

  it("omits filesystem paths from the described catalog", async () => {
    const catalog = describeArtifactCatalog(
      await indexArtifactDirectory(fixtures, { includeDigests: true }),
      presentationFor,
    );
    expect(catalog.kind).toBe("HarnessStudioArtifactCatalogV2");
    expect(isArtifactCatalogResponse(catalog)).toBe(true);
    expect(catalog.artifacts.length).toBeGreaterThan(0);
    for (const descriptor of catalog.artifacts) {
      expect(descriptor).not.toHaveProperty("path");
      expect(descriptor).not.toHaveProperty("kind");
      const base = `/api/artifacts/${descriptor.id}/revisions/${descriptor.revision.digest.slice(7)}`;
      expect(descriptor.revision.content.uri).toBe(`${base}/content`);
      expect(descriptor.adapter.snapshotUri).toBe(`${base}/snapshot`);
      if (descriptor.renderer.status === "ready") {
        expect(descriptor.renderer.bindingId).toMatch(/^sha256:[0-9a-f]{64}$/u);
      }
      if (["cursor-canvas-tsx", "svg", "mmd", "mermaid"].includes(descriptor.format)) {
        expect(descriptor.backing).toBe("code");
        expect(descriptor.build?.snapshotUri).toBe(`${base}/build`);
      } else {
        expect(descriptor.backing).toBe("data");
        expect(descriptor.build).toBeUndefined();
      }
    }
    const malformed = structuredClone(catalog);
    malformed.artifacts[0]!.revision.content.uri = "https://untrusted.invalid/artifact";
    expect(isArtifactCatalogResponse(malformed)).toBe(false);
  });

  it("accepts renderer types and capabilities this build does not know", () => {
    const forward = {
      kind: "HarnessStudioArtifactCatalogV2",
      snapshot: { catalogId: "artifacts-0", revision: `sha256:${"0".repeat(64)}` },
      omitted: [],
      artifacts: [{
        id: "deck-0", threadId: "thread-0", label: "deck.next", size: 1,
        family: "other", format: "next", backing: "code",
        revision: {
          id: `sha256:${"1".repeat(64)}`,
          digest: `sha256:${"1".repeat(64)}`,
          content: { uri: "/api/artifacts/deck-0/revisions/x/content", mediaType: "application/octet-stream", digest: `sha256:${"1".repeat(64)}` },
        },
        adapter: { id: "future.adapter", version: "9", schemaId: "future/v9", snapshotId: `sha256:${"2".repeat(64)}`, snapshotUri: "/api/artifacts/deck-0/revisions/x/snapshot" },
        build: { snapshotUri: "/api/artifacts/deck-0/revisions/x/build" },
        renderer: { id: "future.renderer", label: "Future", provider: "future", type: "holographic", status: "ready" },
        capabilities: ["teleport"],
      }],
    };
    // A newer server must not look like a broken one: an older tab has to keep
    // listing artifacts it cannot render rather than rejecting the response.
    expect(isArtifactCatalogResponse(forward)).toBe(true);
  });

  it("binds the catalog snapshot to exact artifact bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artifact-catalog-"));
    const path = join(directory, "notes.txt");
    await writeFile(path, "first", "utf8");
    await writeFile(join(directory, "stable.txt"), "stable", "utf8");
    const firstIndex = await indexArtifactDirectory(directory, { includeDigests: true });
    const first = describeArtifactCatalog(firstIndex, presentationFor);
    const firstNotesBinding = first.artifacts.find((entry) => entry.id === idOf("notes.txt"))!.renderer.bindingId;
    expect(first.snapshot.catalogId).toMatch(/^artifacts-[0-9a-f]{16}$/u);
    expect(first.snapshot.revision).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.artifacts[0]?.revision.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.artifacts.find((entry) => entry.id === idOf("notes.txt"))?.renderer.id).toBe("studio.text");
    expect(first.artifacts.find((entry) => entry.id === idOf("stable.txt"))?.renderer.id).toBe("studio.text");
    expect(describeArtifactCatalog({ ...firstIndex, entries: [...firstIndex.entries].reverse() }, presentationFor).snapshot).toEqual(first.snapshot);

    await writeFile(path, "second", "utf8");
    resetArtifactDigestCache();
    const second = describeArtifactCatalog(
      await indexArtifactDirectory(directory, { includeDigests: true }),
      presentationFor,
    );
    expect(second.snapshot.revision).not.toBe(first.snapshot.revision);
    expect(second.artifacts[0]?.revision.digest).not.toBe(first.artifacts[0]?.revision.digest);
    expect(second.artifacts.find((entry) => entry.id === idOf("notes.txt"))!.renderer.bindingId)
      .toBe(firstNotesBinding);
  });

  it("moves the catalog revision when presentation changes but bytes do not", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artifact-catalog-"));
    await writeFile(join(directory, "notes.txt"), "same bytes", "utf8");
    const index = await indexArtifactDirectory(directory, { includeDigests: true });
    const native = describeArtifactCatalog(index, presentationFor);
    // Provisioning a renderer rewrites which surface a client should open while
    // every byte on disk stays put. A revision that cannot see that is useless
    // as a refetch key.
    const rebound = describeArtifactCatalog(index, (entry) => ({
      ...presentationFor(entry),
      renderer: {
        id: "qoder-canvas.text",
        label: "Qoder text",
        provider: "qoder-canvas",
        type: "qoder-canvas",
        status: "ready",
        bindingId: `sha256:${"f".repeat(64)}`,
      },
      capabilities: ["navigate"],
    }));
    expect(rebound.snapshot.revision).not.toBe(native.snapshot.revision);
    expect(rebound.artifacts[0]?.revision.digest).toBe(native.artifacts[0]?.revision.digest);
    expect(rebound.artifacts[0]?.renderer.bindingId).not.toBe(native.artifacts[0]?.renderer.bindingId);
    expect(rebound.artifacts[0]?.renderer.bindingId).not.toBe(`sha256:${"f".repeat(64)}`);
  });

  it("binds snapshot and catalog identity to external provider trust metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artifact-provider-catalog-"));
    await writeFile(join(directory, "notes.txt"), "same bytes", "utf8");
    const index = await indexArtifactDirectory(directory, { includeDigests: true });
    const describeWith = (fingerprint: `sha256:${string}`, support: "reviewed" | "experimental-local") => describeArtifactCatalog(index, (entry) => ({
      ...presentationFor(entry),
      provider: {
        providerId: "fixture",
        contributionId: "text",
        fingerprint,
        contributionSupport: support,
        adapterExecutionProfile: "trusted-local-process",
        surfaceSecurityProfile: "opaque-web-v1",
      },
    }));
    const first = describeWith(`sha256:${"a".repeat(64)}`, "experimental-local");
    const changedBytes = describeWith(`sha256:${"b".repeat(64)}`, "experimental-local");
    const changedSupport = describeWith(`sha256:${"b".repeat(64)}`, "reviewed");

    expect(changedBytes.artifacts[0]!.adapter.snapshotId).not.toBe(first.artifacts[0]!.adapter.snapshotId);
    expect(changedBytes.artifacts[0]!.renderer.bindingId).not.toBe(first.artifacts[0]!.renderer.bindingId);
    expect(changedBytes.snapshot.revision).not.toBe(first.snapshot.revision);
    expect(changedSupport.artifacts[0]!.renderer.bindingId).not.toBe(changedBytes.artifacts[0]!.renderer.bindingId);
    expect(changedSupport.snapshot.revision).not.toBe(changedBytes.snapshot.revision);
    expect(changedBytes.artifacts[0]!.revision.digest).toBe(first.artifacts[0]!.revision.digest);
  });

  it("moves binding identity for every adapter, runtime, surface, capability, and provider axis", async () => {
    const index = await indexArtifactDirectory(fixtures, { includeDigests: true });
    const adapter = presentationFor(index.entries.find((entry) => entry.label === "tool-mix.tsx")!).adapter;
    const runtime = {
      id: "provider.hosted-runtime",
      version: "1",
      prepareDocument: async () => "<!doctype html>",
      readModule: async () => "export default {};",
      readResource: async () => undefined,
    };
    const intent = {
      id: "provider.hosted-intent",
      version: "1",
      protocolVersion: "1",
      admit: async (_context: never, input: never) => input,
    } as unknown as NonNullable<ArtifactPluginResolution["intent"]>;
    const base = {
      backing: "code",
      adapter,
      buildRuntime: { id: "studio.build", version: "1", module: { kind: "source" } },
      renderer: {
        id: "provider.diagram",
        label: "Provider diagram",
        provider: "fixture",
        type: "provider-svg",
        status: "ready",
      },
      surface: {
        kind: "external-hosted",
        rendererId: "provider.diagram",
        runtimeId: "provider.viewer",
        securityProfileId: "opaque-web-v1",
        runtime,
      },
      capabilities: ["navigate", "select"],
      intent,
      provider: {
        providerId: "fixture",
        contributionId: "diagram",
        fingerprint: `sha256:${"a".repeat(64)}`,
        contributionSupport: "reviewed",
        adapterExecutionProfile: "trusted-local-process",
        surfaceSecurityProfile: "opaque-web-v1",
      },
    } satisfies ArtifactPluginResolution;
    const variants: Record<string, ArtifactPluginResolution> = {
      backing: { ...base, backing: "data" },
      adapterId: { ...base, adapter: { ...adapter, id: "fixture.adapter-v2" } },
      adapterVersion: { ...base, adapter: { ...adapter, version: "2" } },
      schema: { ...base, adapter: { ...adapter, schemaId: "fixture/v2" } },
      buildRuntimeId: { ...base, buildRuntime: { ...base.buildRuntime, id: "studio.build-v2" } },
      buildRuntimeVersion: { ...base, buildRuntime: { ...base.buildRuntime, version: "2" } },
      rendererId: { ...base, renderer: { ...base.renderer, id: "provider.diagram-v2" } },
      rendererProvider: { ...base, renderer: { ...base.renderer, provider: "fixture-v2" } },
      rendererType: { ...base, renderer: { ...base.renderer, type: "provider-canvas" } },
      surfaceKind: {
        ...base,
        surface: { kind: "studio-sandbox", rendererId: "provider.diagram", runtimeId: "provider.viewer" },
      },
      surfaceRenderer: { ...base, surface: { ...base.surface, rendererId: "provider.diagram-v2" } },
      surfaceRuntime: { ...base, surface: { ...base.surface, runtimeId: "provider.viewer-v2" } },
      hostedRuntimeId: { ...base, surface: { ...base.surface, runtime: { ...runtime, id: "provider.hosted-runtime-v2" } } },
      hostedRuntimeVersion: { ...base, surface: { ...base.surface, runtime: { ...runtime, version: "2" } } },
      intentRuntimeId: { ...base, intent: { ...intent, id: "provider.hosted-intent-v2" } },
      intentRuntimeVersion: { ...base, intent: { ...intent, version: "2" } },
      intentProtocolVersion: {
        ...base,
        intent: { ...intent, protocolVersion: "2" } as unknown as NonNullable<ArtifactPluginResolution["intent"]>,
      },
      capabilities: { ...base, capabilities: ["navigate", "zoom"] },
      providerId: { ...base, provider: { ...base.provider, providerId: "fixture-v2" } },
      contributionId: { ...base, provider: { ...base.provider, contributionId: "diagram-v2" } },
      fingerprint: { ...base, provider: { ...base.provider, fingerprint: `sha256:${"b".repeat(64)}` } },
      support: { ...base, provider: { ...base.provider, contributionSupport: "experimental-local" } },
      executionProfile: { ...base, provider: { ...base.provider, adapterExecutionProfile: "confined-wasm" } },
      securityProfile: { ...base, provider: { ...base.provider, surfaceSecurityProfile: undefined } },
    };
    const baseId = artifactSurfaceBindingId(base);

    for (const [axis, variant] of Object.entries(variants)) {
      expect(artifactSurfaceBindingId(variant), axis).not.toBe(baseId);
    }
    expect(artifactSurfaceBindingId({ ...base, capabilities: ["select", "navigate", "navigate"] }))
      .toBe(baseId);
  });

  it("refuses to mint a revision snapshot without exact-byte digests", async () => {
    const index = await indexArtifactDirectory(fixtures);
    expect(() => describeArtifactCatalog(index, presentationFor)).toThrow(ArtifactCatalogContractError);
  });

  it("disambiguates ids that collide after sanitizing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artifact-catalog-"));
    await writeFile(join(directory, "a b.tsx"), "export default () => null;\n", "utf8");
    await writeFile(join(directory, "a-b.tsx"), "export default () => null;\n", "utf8");
    const ids = (await indexArtifactDirectory(directory)).entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports declined entries instead of dropping them silently", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artifact-catalog-"));
    await symlink("/etc/hosts", join(directory, "leak.txt"));
    const source = join(directory, "source.txt");
    await writeFile(source, "shared inode", "utf8");
    await link(source, join(directory, "alias.txt"));

    const index = await indexArtifactDirectory(directory);

    expect(index.entries).toEqual([]);
    expect(index.omitted).toEqual(expect.arrayContaining([
      { label: "leak.txt", reason: "symlink" },
      { label: "alias.txt", reason: "hard-link" },
      { label: "source.txt", reason: "hard-link" },
    ]));
    // Opting in is explicit, so a build that links its outputs is not silently broken.
    const permissive = await indexArtifactDirectory(directory, { allowLinkedFiles: true });
    expect(permissive.entries.map((entry) => entry.label).sort()).toEqual(["alias.txt", "source.txt"]);
    expect(permissive.omitted).toEqual([{ label: "leak.txt", reason: "symlink" }]);
  });
});
