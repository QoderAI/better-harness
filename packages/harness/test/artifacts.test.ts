import { describe, expect, it } from "vitest";
import {
  ARTIFACT_PROVIDER_API_VERSION,
  defineArtifactProvider,
  isArtifactBuildSnapshot,
  isArtifactCatalogResponse,
  isArtifactDataSnapshot,
  type ArtifactDataSnapshot,
  type ExternalArtifactProvider,
} from "../src/artifacts/index.js";

const DIGEST = `sha256:${"a".repeat(64)}` as const;

describe("Artifact provider SDK", () => {
  it("preserves provider literal types without importing a Studio host", () => {
    const receipt: ExternalArtifactProvider["receipt"] = {
      kind: "HarnessStudioExternalArtifactProviderReceiptV1",
      providerId: "fixture",
      providerVersion: "1",
      providerDescriptorDigest: DIGEST,
      assets: [],
      driverVersions: {},
    };
    const provider = defineArtifactProvider({
      id: "fixture",
      label: "Fixture",
      version: "1",
      acquisition: "operator-provisioned",
      fingerprint: DIGEST,
      receipt,
      contributions: [],
    });

    expect(ARTIFACT_PROVIDER_API_VERSION).toBe("1");
    expect(provider.id).toBe("fixture");
  });

  it("keeps custom provider payloads forward compatible inside the common envelope", () => {
    const snapshot: ArtifactDataSnapshot = {
      kind: "ArtifactDataSnapshotV1",
      artifactId: "diagram",
      revisionId: DIGEST,
      snapshotId: DIGEST,
      adapter: { id: "fixture", version: "1" },
      schemaId: "fixture/v1",
      summary: { label: "diagram.dsl", family: "images-diagrams", format: "dsl" },
      structure: [],
      semanticIndex: [],
      resources: [],
      diagnostics: [],
      payload: { kind: "external:homology/structurizr-v1", viewKey: "SystemContext" },
    };
    expect(isArtifactDataSnapshot(snapshot)).toBe(true);
  });

  it("accepts an optional renderer binding identity and rejects malformed identities", () => {
    const catalog = {
      kind: "HarnessStudioArtifactCatalogV2",
      snapshot: { catalogId: "fixture", revision: DIGEST },
      artifacts: [{
        id: "notes",
        threadId: "thread-notes",
        label: "notes.md",
        size: 12,
        family: "source-text",
        format: "md",
        backing: "data",
        revision: {
          id: DIGEST,
          digest: DIGEST,
          content: {
            uri: `/api/artifacts/notes/revisions/${"a".repeat(64)}/content`,
            mediaType: "text/markdown; charset=utf-8",
            digest: DIGEST,
          },
        },
        adapter: {
          id: "studio.markdown",
          version: "1",
          schemaId: "artifact/markdown-v1",
          snapshotId: DIGEST,
          snapshotUri: `/api/artifacts/notes/revisions/${"a".repeat(64)}/snapshot`,
        },
        interaction: {
          workspaceUri: `/api/artifacts/notes/revisions/${"a".repeat(64)}/interaction`,
        },
        intent: {
          intentUri: `/api/artifacts/notes/revisions/${"a".repeat(64)}/intents`,
        },
        renderer: {
          id: "studio.markdown",
          label: "Studio Markdown",
          provider: "studio",
          type: "native",
          status: "ready",
        },
        capabilities: ["navigate", "outline"],
      }],
      omitted: [],
    };

    expect(isArtifactCatalogResponse(catalog)).toBe(true);
    catalog.artifacts[0]!.intent.intentUri = "https://untrusted.invalid/intents";
    expect(isArtifactCatalogResponse(catalog)).toBe(false);
    catalog.artifacts[0]!.intent.intentUri = `/api/artifacts/notes/revisions/${"a".repeat(64)}/intents`;
    expect(isArtifactCatalogResponse(catalog)).toBe(true);
    catalog.artifacts[0]!.interaction.workspaceUri = "https://untrusted.invalid/interaction";
    expect(isArtifactCatalogResponse(catalog)).toBe(false);
    catalog.artifacts[0]!.interaction.workspaceUri = `/api/artifacts/notes/revisions/${"a".repeat(64)}/interaction`;
    catalog.artifacts[0]!.renderer.bindingId = DIGEST;
    expect(isArtifactCatalogResponse(catalog)).toBe(true);
    catalog.artifacts[0]!.renderer.bindingId = "not-a-digest";
    expect(isArtifactCatalogResponse(catalog)).toBe(false);
  });

  it("validates AgentReact metadata on immutable build snapshots", () => {
    const snapshot = {
      kind: "ArtifactBuildSnapshotV1",
      artifactId: "orders",
      revisionId: DIGEST,
      buildId: DIGEST,
      sequence: 1,
      status: "ready",
      runtime: { id: "studio.sandboxed-react", version: "4" },
      previewUri: `/api/artifacts/orders/revisions/${"a".repeat(64)}/builds/${"a".repeat(64)}/preview`,
      diagnostics: [],
      agentReact: {
        protocolVersion: "agent-react/1",
        artifactDigest: DIGEST,
        buildDigest: DIGEST,
        buildPolicyDigest: DIGEST,
        view: {
          id: "orders",
          state: [{ path: "/orders", schema: "list", version: 1 }],
          capabilities: ["studio.show-source"],
        },
      },
    };

    expect(isArtifactBuildSnapshot(snapshot)).toBe(true);
    snapshot.agentReact.view.state[0]!.version = 0;
    expect(isArtifactBuildSnapshot(snapshot)).toBe(false);
  });
});
