import { describe, expect, it } from "vitest";
import {
  CUSTOMIZATION_CATALOG_KIND,
  CUSTOMIZATION_SCHEMA_VERSION,
  assertCustomizationCatalogV1,
  customizationId,
  customizationRevision,
  summarizeCustomizationCatalog,
  type CustomizationCatalogV1,
} from "../src/customization/index.js";

const source = { evidenceId: "evidence:skill", scope: "project" as const, logicalPath: "Workspace/.agents/skills/review" };

function catalog(): CustomizationCatalogV1 {
  const definitionId = customizationId("definition", ["agent-skill", "physical-source"]);
  const revisionId = customizationRevision({ name: "review", description: "Review changes." });
  return {
    kind: CUSTOMIZATION_CATALOG_KIND,
    schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
    generatedAt: "2026-08-22T00:00:00.000Z",
    workspace: { label: "fixture", evidenceId: "workspace:fixture" },
    hosts: [
      { id: "codex", label: "Codex", status: "ok" },
      { id: "qoder", label: "Qoder", status: "ok" },
    ],
    packages: [],
    definitions: [{
      kind: "agent-skill",
      id: definitionId,
      name: "review",
      description: "Review changes.",
      format: { id: "agent-skills", conformance: "standard" },
      revision: { revisionId, completeness: "partial" },
      source,
      validation: { status: "valid", diagnostics: [] },
      entry: { mediaType: "text/markdown" },
      resources: [],
    }],
    installations: [],
    exposures: ["codex", "qoder"].map((hostId) => ({
      kind: "host-exposure" as const,
      id: customizationId("exposure", [definitionId, hostId]),
      definitionId,
      hostId,
      scope: "project" as const,
      discovery: "valid" as const,
      enablement: "unspecified" as const,
      availability: "available" as const,
      activation: "not-observed" as const,
      execution: "not-observed" as const,
      source,
    })),
    registrations: [],
    runtimeObservations: [],
  };
}

describe("Customization Catalog V1", () => {
  it("keeps one definition with independent Host exposures", () => {
    const value = catalog();
    expect(() => assertCustomizationCatalogV1(value)).not.toThrow();
    expect(value.definitions).toHaveLength(1);
    expect(value.exposures.map(({ hostId }) => hostId)).toEqual(["codex", "qoder"]);
    const summary = summarizeCustomizationCatalog(value);
    expect(summary).toMatchObject({
      definitionCount: 1,
      exposureCount: 2,
      hosts: [
        { id: "codex", definitions: 1 },
        { id: "qoder", definitions: 1 },
      ],
    });
    expect(Object.keys(summary.definitionsByKind)).toEqual([
      "instruction",
      "agent-skill",
      "prompt-command",
      "agent-definition",
      "hook",
      "mcp-server-definition",
    ]);
    expect("relationships" in value).toBe(false);
  });

  it("rejects dangling exposure references", () => {
    const value = catalog();
    value.exposures[0] = { ...value.exposures[0]!, definitionId: "definition:missing" };
    expect(() => assertCustomizationCatalogV1(value)).toThrow(/unknown definition/u);
  });

  it("builds deterministic opaque ids and revisions", () => {
    expect(customizationId("definition", { route: "a", kind: "agent-skill" }))
      .toBe(customizationId("definition", { kind: "agent-skill", route: "a" }));
    expect(customizationRevision({ name: "review" })).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
