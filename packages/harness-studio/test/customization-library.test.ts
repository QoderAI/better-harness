import { expect, it } from "vitest";
import type { CustomizationCatalogV1, InstructionDefinitionV1, HostExposureV1 } from "@qoder-ai/harness/customization";
import { customizationAgentFacets, customizationLibraryRows, filterCustomizationRows, searchCustomizationRows } from "../src/app/customization-library.js";
const source = { evidenceId: "source", scope: "project" as const, logicalPath: "Workspace/AGENTS.md" };
function fixture(): CustomizationCatalogV1 {
  const definition: InstructionDefinitionV1 = { kind: "instruction", id: "shared", name: "Guidance", source, format: { id: "markdown", conformance: "standard" }, revision: { revisionId: "sha256:a", completeness: "complete" }, validation: { status: "valid", diagnostics: [] }, instructionRole: "project", composition: "append" };
  const edge = (hostId: string): HostExposureV1 => ({ kind: "host-exposure", id: hostId, definitionId: "shared", hostId, scope: "project", discovery: "valid", enablement: "unknown", availability: "unknown", activation: "unknown", execution: "unknown", source });
  return { kind: "BetterHarnessCustomizationCatalogV1", schemaVersion: "better-harness.customization/v1", generatedAt: "2026-09-08T00:00:00Z", workspace: { label: "fixture", evidenceId: "workspace" }, hosts: [], definitions: [definition, { ...definition, id: "unassigned", name: "Codex in a name is not provenance" }], packages: [], installations: [], exposures: [edge("codex"), edge("qoder"), { ...edge("codex"), id: "duplicate" }], registrations: [], runtimeObservations: [] };
}
it("deduplicates shared Agent edges and never guesses an unassigned source", () => {
  const rows = customizationLibraryRows(fixture());
  expect(filterCustomizationRows(rows, "instructions", "codex").map(row => row.hosts)).toEqual([["codex", "qoder"]]);
  expect(filterCustomizationRows(rows, "instructions", "unassigned").map(row => row.id)).toEqual(["unassigned"]);
  expect(filterCustomizationRows(rows, "skills", "all")).toEqual([]);
});
it("links tools through discovery registrations and preserves stale evidence", () => {
  const catalog = fixture();
  catalog.registrations.push({ kind: "mcp-server-registration", id: "server", definitionId: "mcp", hostId: "qoder", scope: "project", alias: "server", transport: { kind: "unknown" }, enablement: "enabled", environmentKeys: [], headerNames: [], validation: { status: "valid", diagnostics: [] }, source });
  catalog.runtimeObservations.push({ kind: "mcp-server-discovery", id: "discovery", registrationId: "server", status: "succeeded", evidenceSource: "host-cache", freshness: "expired", catalog: [{ kind: "mcp-tool", id: "tool", discoveryId: "discovery", name: "lookup", descriptorDigest: "sha256:a" }] });
  expect(filterCustomizationRows(customizationLibraryRows(catalog), "tools", "qoder")).toEqual([expect.objectContaining({ name: "lookup", hosts: ["qoder"], evidence: "expired" })]);
  expect(filterCustomizationRows(customizationLibraryRows(catalog), "tools", "codex")).toEqual([]);
});
it("describes the Agent dimension as rows: All, every observed Host, and only a real unassigned bucket", () => {
  const catalog = fixture();
  catalog.hosts = [
    { id: "codex", label: "Codex", status: "ok" },
    { id: "claude", label: "Claude", status: "error" },
    { id: "qoder", label: "Qoder", status: "ok" },
  ];
  const rows = customizationLibraryRows(catalog);
  expect(customizationAgentFacets({ rows, category: "instructions", hosts: catalog.hosts })).toEqual([
    { id: "all", count: 2 },
    // Claude collected nothing, so its row reports the status instead of a count
    // that would read as a clean empty result.
    { id: "claude", label: "Claude", status: "error", count: 0 },
    { id: "codex", label: "Codex", count: 1 },
    { id: "qoder", label: "Qoder", count: 1 },
    { id: "unassigned", count: 1 },
  ]);
  // A category with no entries keeps every Host row, and drops the unassigned row
  // because no entry in the catalog lacks an Agent edge there.
  expect(customizationAgentFacets({ rows: rows.filter((row) => row.hosts.length > 0), category: "skills", hosts: catalog.hosts })).toEqual([
    { id: "all", count: 0 },
    { id: "claude", label: "Claude", status: "error", count: 0 },
    { id: "codex", label: "Codex", count: 0 },
    { id: "qoder", label: "Qoder", count: 0 },
  ]);
});
it("filters entries by the fields a row shows, after the category and Agent scope", () => {
  const rows = customizationLibraryRows(fixture()).map((row) => ({ ...row, description: row.id === "shared" ? "Project guidance" : undefined }));
  expect(searchCustomizationRows(rows, "  GUID ").map((row) => row.id)).toEqual(["shared"]);
  expect(searchCustomizationRows(rows, "project guidance").map((row) => row.id)).toEqual(["shared"]);
  expect(searchCustomizationRows(rows, "agents.md").map((row) => row.id).sort()).toEqual(["shared", "unassigned"]);
  expect(searchCustomizationRows(rows, "")).toHaveLength(rows.length);
  expect(searchCustomizationRows(rows, "nothing-here")).toEqual([]);
});
