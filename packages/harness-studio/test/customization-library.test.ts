import { expect, it } from "vitest";
import type { CustomizationCatalogV1, InstructionDefinitionV1, HostExposureV1 } from "@qoder-ai/harness/customization";
import { customizationAgentFacets, customizationLibraryRows, customizationRowUsage, customizationUsageObservable, filterCustomizationRows, searchCustomizationRows, CUSTOMIZATION_CATEGORIES, CUSTOMIZATION_DEFAULT_CATEGORY, isCustomizationCategory } from "../src/app/customization-library.js";
import type { CustomizationUsageV1 } from "../src/contracts/customization-usage.js";
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

const usage: CustomizationUsageV1 = {
  kind: "BetterHarnessCustomizationUsageV1",
  schemaVersion: 1,
  observedSessions: 4,
  window: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-05T00:00:00.000Z" },
  entries: [
    { kind: "skill", hostId: "codex", name: "review", count: 2, lastObservedAt: "2026-09-02T00:00:00.000Z" },
    { kind: "skill", hostId: "qoder", name: "review", count: 5, lastObservedAt: "2026-09-04T00:00:00.000Z" },
    { kind: "skill", hostId: "claude", name: "unexposed-skill", count: 9 },
    { kind: "mcp-server", hostId: "qoder", name: "schedule", count: 3 },
  ],
};
const skillRow = { id: "skill", category: "skills" as const, name: "Review", hosts: ["codex", "qoder"], scope: "project", evidence: "valid" };

it("reads an observation only for the Hosts a row is exposed to, following the Agent filter", () => {
  // Both exposing Agents, then one at a time: the number always answers the
  // question the filter is asking.
  expect(customizationRowUsage(skillRow, usage, "all")).toEqual({ count: 7, lastObservedAt: "2026-09-04T00:00:00.000Z" });
  expect(customizationRowUsage(skillRow, usage, "codex")).toEqual({ count: 2, lastObservedAt: "2026-09-02T00:00:00.000Z" });
  expect(customizationRowUsage(skillRow, usage, "qoder")).toEqual({ count: 5, lastObservedAt: "2026-09-04T00:00:00.000Z" });
  // Claude invoked a Skill of the same kind, but not this definition's row.
  expect(customizationRowUsage(skillRow, usage, "claude")).toBeUndefined();
  expect(customizationRowUsage({ ...skillRow, hosts: [] }, usage, "all")).toBeUndefined();
});

it("matches a Host's namespaced invocation name and never invents a zero", () => {
  expect(customizationRowUsage({ ...skillRow, name: "better-harness:review" }, usage, "qoder")).toEqual({ count: 5, lastObservedAt: "2026-09-04T00:00:00.000Z" });
  expect(customizationRowUsage({ ...skillRow, name: "other" }, usage, "all")).toBeUndefined();
  expect(customizationRowUsage(skillRow, undefined, "all")).toBeUndefined();
  // An MCP registration matches its own kind, and a Hook row is never matched to
  // a Skill observation of the same name.
  expect(customizationRowUsage({ ...skillRow, category: "mcp", name: "schedule", hosts: ["qoder"] }, usage, "all")).toEqual({ count: 3 });
  expect(customizationRowUsage({ ...skillRow, category: "hooks", name: "review" }, usage, "all")).toBeUndefined();
});

it("only claims a category is observable when a rule exists for it", () => {
  expect(["skills", "mcp"].map(customizationUsageObservable)).toEqual([true, true]);
  expect(["plugins", "instructions", "agents", "hooks", "tools", "commands"].map(customizationUsageObservable)).toEqual([false, false, false, false, false, false]);
});

it("navigates the catalog by kind alone, with a real category as the default landing row", () => {
  // Every category the sidebar can offer names a kind rows actually carry, so a
  // row can never fall outside the navigation.
  const kinds = new Set(customizationLibraryRows(fixture()).map((row) => row.category));
  for (const kind of kinds) expect(CUSTOMIZATION_CATEGORIES).toContain(kind);
  expect(CUSTOMIZATION_CATEGORIES).toContain(CUSTOMIZATION_DEFAULT_CATEGORY);
  expect(isCustomizationCategory(CUSTOMIZATION_DEFAULT_CATEGORY)).toBe(true);
  // The retired aggregate row is not a route or a filter any more.
  expect(isCustomizationCategory("overview")).toBe(false);
  expect(isCustomizationCategory(undefined)).toBe(false);
});
