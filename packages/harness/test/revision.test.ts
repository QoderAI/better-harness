import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileHarness } from "../src/compiler/compile.js";
import type { HarnessIrBundle, HarnessRevision } from "../src/ir/index.js";
import {
  HarnessAdapterMismatchError,
  HarnessRevisionBundleMismatchError,
  HarnessRevisionTamperedError,
  HarnessSourceLockError,
  assertRevisionIntegrity,
} from "../src/ir/revision.js";
import { resolveHarness } from "../src/resolver/resolve.js";
import { describeAdapter } from "../src/resolver/adapter-descriptor.js";
import { lockCapabilitySources } from "../src/resolver/source-lock.js";
import { QoderSdkAdapter, QoderSdkExecutor, type QoderSdkLike } from "../src/exec/qoder-sdk.js";

function source(guidance: string, adapter = "@harness/adapter-qoder"): string {
  return `
    language 0.3
    skill impact-analysis {
      description "${guidance}"
    }
    workflow solo-loop {
      session coder
    }
    harness assembly {
      workflow solo-loop
      agent coder {
        use skill impact-analysis
      }
    }
    runtime qoder { adapter "${adapter}" }
    deployment assembly-qoder { harness assembly runtime qoder }
  `;
}

async function compileBundle(text: string): Promise<HarnessIrBundle> {
  const { bundle, diagnostics } = await compileHarness(text);
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  return bundle!;
}

/** An SDK loader that records whether it was ever reached. */
function trackingLoader(): { loadSdk: () => Promise<QoderSdkLike>; loaded: () => boolean } {
  let loaded = false;
  return {
    loadSdk: async () => {
      loaded = true;
      throw new Error("the host SDK must not load for a rejected revision");
    },
    loaded: () => loaded,
  };
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("revision execution closure", () => {
  it("hashes the optional component snapshot cross-reference", async () => {
    const bundle = await compileBundle(source("Map the blast radius before editing."));
    const descriptor = new QoderSdkAdapter().describe();
    const first = resolveHarness(bundle, "assembly", "qoder", {
      adapter: descriptor,
      componentSnapshotRef: { snapshotId: "snapshot-1", digest: "sha256:abc" },
    }).revision!;
    const second = resolveHarness(bundle, "assembly", "qoder", {
      adapter: descriptor,
      componentSnapshotRef: { snapshotId: "snapshot-1", digest: "sha256:def" },
    }).revision!;

    expect(first.componentSnapshotRef).toEqual({ snapshotId: "snapshot-1", digest: "sha256:abc" });
    expect(first.revisionId).not.toBe(second.revisionId);
    expect(() => assertRevisionIntegrity(first)).not.toThrow();
  });

  it("refuses execution against a bundle the revision was not resolved from", async () => {
    const resolvedBundle = await compileBundle(source("Map the blast radius before editing."));
    const otherBundle = await compileBundle(source("Skip the analysis and start editing."));
    const descriptor = new QoderSdkAdapter().describe();
    const { revision } = resolveHarness(resolvedBundle, "assembly", "qoder", { adapter: descriptor });
    const loader = trackingLoader();

    // Both bundles declare the same harness id, so only recomputed content
    // hashes can tell them apart.
    expect(otherBundle.harnesses[0].id).toBe(revision!.harness.id);
    await expect(
      new QoderSdkExecutor({ loadSdk: loader.loadSdk }).execute(revision!, otherBundle, {
        prompt: "Fix the bug",
      }),
    ).rejects.toThrow(HarnessRevisionBundleMismatchError);
    expect(loader.loaded()).toBe(false);

    // The revision still runs against its own bundle: the check is content
    // identity, not a blanket refusal, so this call gets as far as the SDK
    // loader instead of being rejected up front.
    const reached = await new QoderSdkExecutor({ loadSdk: loader.loadSdk })
      .execute(revision!, resolvedBundle, { prompt: "Fix the bug" })
      .catch((error: unknown) => error);
    expect(reached).not.toBeInstanceOf(HarnessRevisionBundleMismatchError);
    expect(loader.loaded()).toBe(true);
  });

  it("detects a mutated revision before the host SDK loads", async () => {
    const bundle = await compileBundle(source("Map the blast radius before editing."));
    const { revision } = resolveHarness(bundle, "assembly", "qoder", {
      adapter: new QoderSdkAdapter().describe(),
    });
    const locked = revision!.resolved.capabilities[0] as { contentHash: string };

    // A resolved revision is frozen all the way down, so the edit cannot even
    // be applied in place.
    expect(() => {
      locked.contentHash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    }).toThrow(TypeError);
    expect(Object.isFrozen(revision!.resolved.capabilities[0])).toBe(true);

    // A forged copy that keeps the original id is caught by recomputation.
    const forged = structuredClone(revision!) as HarnessRevision;
    (forged.resolved.capabilities[0] as { contentHash: string }).contentHash =
      "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    expect(forged.revisionId).toBe(revision!.revisionId);
    expect(() => assertRevisionIntegrity(forged)).toThrow(HarnessRevisionTamperedError);

    const loader = trackingLoader();
    await expect(
      new QoderSdkExecutor({ loadSdk: loader.loadSdk }).execute(forged, bundle, { prompt: "Fix the bug" }),
    ).rejects.toThrow(HarnessRevisionTamperedError);
    expect(loader.loaded()).toBe(false);
  });

  it("refuses an adapter package the revision did not target", async () => {
    const bundle = await compileBundle(
      source("Map the blast radius before editing.", "@harness/adapter-forked"),
    );
    const { revision } = resolveHarness(bundle, "assembly", "qoder", {
      adapter: describeAdapter({ adapterId: "@harness/adapter-forked" }),
    });
    const loader = trackingLoader();

    // Same host runtime, different adapter package: the runtime check alone
    // would let this through.
    expect(revision!.target.runtime).toBe("qoder");
    expect(revision!.target.adapter).toBe("@harness/adapter-forked");
    await expect(
      new QoderSdkAdapter({ loadSdk: loader.loadSdk }).doStart({ revision: revision!, bundle }),
    ).rejects.toThrow(HarnessAdapterMismatchError);
    expect(loader.loaded()).toBe(false);
  });

  it("refuses a revision whose locked skill source changed on disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "harness-source-lock-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "skills", "impact"), { recursive: true });
    await writeFile(join(root, "skills", "impact", "SKILL.md"), "# Impact analysis\nOriginal.\n", "utf8");
    const bundle = await compileBundle(`
      language 0.3
      skill impact-analysis {
        source "./skills/impact"
        description "Map the blast radius before editing."
      }
      workflow solo-loop {
        session coder
      }
      harness assembly {
        workflow solo-loop
        agent coder {
          use skill impact-analysis
        }
      }
      runtime qoder { adapter "@harness/adapter-qoder" }
      deployment assembly-qoder { harness assembly runtime qoder }
    `);
    const sourceLocks = await lockCapabilitySources(bundle, { root });
    const { revision } = resolveHarness(bundle, "assembly", "qoder", {
      sourceLocks,
      adapter: new QoderSdkAdapter().describe(),
    });
    expect(revision!.sourceLocks).toEqual([
      expect.objectContaining({ capabilityId: "impact-analysis", uri: "./skills/impact", files: 1 }),
    ]);

    await writeFile(join(root, "skills", "impact", "SKILL.md"), "# Impact analysis\nRewritten.\n", "utf8");
    const loader = trackingLoader();

    await expect(
      new QoderSdkAdapter({ loadSdk: loader.loadSdk }).doStart({
        revision: revision!,
        bundle,
        sourceRoot: root,
      }),
    ).rejects.toThrow(HarnessSourceLockError);
    expect(loader.loaded()).toBe(false);
  });

  it("does not resolve a source-backed skill without a complete lock", async () => {
    const bundle = await compileBundle(`
      language 0.3
      skill impact-analysis {
        source "./skills/impact"
        description "Map the blast radius before editing."
      }
      workflow solo-loop { session coder }
      harness assembly {
        workflow solo-loop
        agent coder { use skill impact-analysis }
      }
      runtime qoder { adapter "@harness/adapter-qoder" }
      deployment assembly-qoder { harness assembly runtime qoder }
    `);

    const { revision, report } = resolveHarness(bundle, "assembly", "qoder");

    expect(revision).toBeUndefined();
    expect(report.status).toBe("failed");
    expect(report.errors).toContainEqual(expect.stringContaining("requires exactly one content lock"));
  });
});
