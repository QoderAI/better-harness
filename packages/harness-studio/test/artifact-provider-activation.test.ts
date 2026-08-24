import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExternalArtifactProvider } from "../src/server/artifact-adapter-contract.js";
import { PROVIDER_HOSTED_CANVAS_TSX_FORMAT } from "../src/server/artifact-catalog.js";
import {
  activateArtifactContribution,
  defaultArtifactProviderStateRoot,
  deactivateArtifactContribution,
  importLegacyQoderActivationsOnce,
  readArtifactProviderActivationState,
} from "../src/server/artifact-provider-activation.js";
import { RAW_ARTIFACT_ADAPTER } from "../src/server/artifact-plugin-registry.js";
import { parseArtifactProviderArgs, runArtifactProviderCli } from "../src/server/artifact-provider-cli.js";

const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;

describe("Artifact provider activation", () => {
  it("uses portable platform-owned configuration roots", () => {
    expect(defaultArtifactProviderStateRoot({}, "darwin", "/Users/me"))
      .toBe("/Users/me/Library/Application Support/QoderAI/HarnessStudio");
    expect(defaultArtifactProviderStateRoot({ XDG_CONFIG_HOME: "/config" }, "linux", "/home/me"))
      .toBe("/config/harness-studio");
    expect(defaultArtifactProviderStateRoot({ APPDATA: "C:\\config" }, "win32", "C:\\Users\\me"))
      .toBe("C:\\config\\QoderAI\\HarnessStudio");
  });

  it("atomically persists explicit fingerprint-bound activation and deactivation", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-provider-state-"));
    const provider = fixtureProvider(DIGEST_A);
    const activated = await activateArtifactContribution(
      provider,
      "pptx",
      "external-override",
      { formats: ["PPTX"] },
      { root, now: () => new Date("2026-08-22T01:00:00.000Z") },
    );
    expect(activated.activations).toEqual([expect.objectContaining({
      providerId: "fixture",
      contributionId: "pptx",
      fingerprint: DIGEST_A,
      matcher: { formats: ["pptx"] },
      consent: "explicit",
      adapterExecutionProfile: "trusted-local-process",
      surfaceSecurityProfile: "opaque-web-v1",
    })]);
    const persisted = await readArtifactProviderActivationState({ root });
    expect(persisted).toEqual(activated);
    expect(JSON.parse(await readFile(join(root, "artifact-providers", "activations.json"), "utf8"))).toEqual(activated);

    expect((await deactivateArtifactContribution("fixture", "pptx", { root })).activations).toEqual([]);
  });

  it("imports legacy data overrides once and never re-authorizes changed fingerprints", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-provider-migration-"));
    const first = await importLegacyQoderActivationsOnce(
      [fixtureProvider(DIGEST_A)],
      DIGEST_A,
      { root, now: () => new Date("2026-08-22T02:00:00.000Z") },
    );
    expect(first.activations.map((activation) => activation.contributionId)).toEqual(["pptx"]);
    expect(first.activations[0]).toMatchObject({ consent: "legacy-import", fingerprint: DIGEST_A });
    expect(first.migrations).toEqual([{ id: "qoder-canvas-manifest-v1", sourceFingerprint: DIGEST_A, importedAt: "2026-08-22T02:00:00.000Z" }]);

    const second = await importLegacyQoderActivationsOnce([fixtureProvider(DIGEST_B)], DIGEST_B, { root });
    expect(second).toEqual(first);
  });

  it("requires explicit portable scope in the provider CLI", () => {
    expect(parseArtifactProviderArgs([
      "activate", "--provider", "fixture", "--contribution", "pptx", "--lane", "external-fallback", "--format", "pptx",
    ])).toMatchObject({ command: "activate", providerId: "fixture", matcher: { formats: ["pptx"] } });
    expect(parseArtifactProviderArgs(["activate", "--lane", "highest"]).error).toContain("--lane");
  });

  it("allows document overrides but refuses authored-code overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-provider-protected-"));
    const activated = await activateArtifactContribution(
      fixtureProvider(DIGEST_A), "svg", "external-override", { formats: ["svg", "mermaid"] }, { root },
    );
    expect(activated.activations).toMatchObject([{ lane: "external-override", matcher: { formats: ["mermaid", "svg"] } }]);
    await expect(activateArtifactContribution(
      fixtureProvider(DIGEST_A), "svg", "external-override", { formats: ["tsx"] }, { root },
    )).rejects.toThrow("Protected authored TSX and JSX");
    expect((await readArtifactProviderActivationState({ root })).activations).toEqual(activated.activations);
  });

  it("activates the dedicated Canvas TSX format only in the fallback lane", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-provider-canvas-format-"));
    const provider = fixtureProvider(DIGEST_A);
    const activated = await activateArtifactContribution(
      provider,
      "cursor-canvas",
      "external-fallback",
      { formats: [PROVIDER_HOSTED_CANVAS_TSX_FORMAT] },
      { root },
    );
    expect(activated.activations).toMatchObject([{
      contributionId: "cursor-canvas",
      lane: "external-fallback",
      matcher: { formats: [PROVIDER_HOSTED_CANVAS_TSX_FORMAT] },
    }]);
    await expect(activateArtifactContribution(
      provider,
      "cursor-canvas",
      "external-override",
      { formats: [PROVIDER_HOSTED_CANVAS_TSX_FORMAT] },
      { root },
    )).rejects.toThrow("Protected authored TSX and JSX");
    expect((await readArtifactProviderActivationState({ root })).activations).toEqual(activated.activations);
  });

  it("lists and deactivates through path-redacted CLI operations", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-provider-cli-"));
    await activateArtifactContribution(fixtureProvider(DIGEST_A), "pptx", "external-fallback", { formats: ["pptx"] }, { root });
    const stdout: string[] = [];
    const stderr: string[] = [];
    expect(await runArtifactProviderCli([
      "deactivate", "--provider", "fixture", "--contribution", "pptx", "--state-root", root, "--json",
    ], { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) })).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join("")).activations).toEqual([]);
    expect((await readArtifactProviderActivationState({ root })).activations).toEqual([]);
  });
});

function fixtureProvider(fingerprint: typeof DIGEST_A | typeof DIGEST_B): ExternalArtifactProvider {
  const common = {
    adapter: RAW_ARTIFACT_ADAPTER,
    renderer: { id: "fixture.renderer", label: "Fixture", provider: "fixture", type: "qoder-canvas", status: "ready" } as const,
    surface: {
      kind: "external-hosted",
      rendererId: "fixture.renderer",
      runtimeId: "fixture.runtime",
      securityProfileId: "opaque-web-v1",
      runtime: {
        id: "fixture.runtime",
        version: "1",
        prepareDocument: async () => "<!doctype html>",
        readModule: async () => "",
        readResource: async () => undefined,
      },
    } as const,
    capabilities: ["navigate"] as const,
    support: "experimental-local" as const,
    adapterExecutionProfile: "trusted-local-process" as const,
    legacyOverrideRequested: true,
  };
  return {
    id: "fixture",
    label: "Fixture",
    version: "1",
    acquisition: "operator-provisioned",
    fingerprint,
    receipt: {
      kind: "HarnessStudioExternalArtifactProviderReceiptV1",
      providerId: "fixture",
      providerVersion: "1",
      providerDescriptorDigest: fingerprint,
      assets: [],
      driverVersions: {},
    },
    contributions: [
      { ...common, id: "pptx", label: "PPTX", matcher: { formats: ["pptx"] } },
      { ...common, id: "svg", label: "SVG", matcher: { formats: ["svg"] } },
      { ...common, id: "cursor-canvas", label: "Cursor Canvas", matcher: { formats: [PROVIDER_HOSTED_CANVAS_TSX_FORMAT] } },
    ],
  };
}
