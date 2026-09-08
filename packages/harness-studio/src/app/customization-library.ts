import type { CustomizationCatalogV1 } from "@qoder-ai/harness/customization";

export const CUSTOMIZATION_CATEGORIES = ["overview", "plugins", "mcp", "skills", "instructions", "agents", "hooks", "tools", "commands"] as const;
export type CustomizationCategory = typeof CUSTOMIZATION_CATEGORIES[number];
export interface CustomizationLibraryRow {
  id: string;
  category: Exclude<CustomizationCategory, "overview">;
  name: string;
  description?: string;
  hosts: string[];
  source?: string;
  scope: string;
  evidence: string;
}

/** Associations are explicit catalog edges, never guessed from paths or names. */
export function customizationLibraryRows(catalog: CustomizationCatalogV1): CustomizationLibraryRow[] {
  const categories = { "agent-skill": "skills", "agent-definition": "agents", "mcp-server-definition": "mcp", "prompt-command": "commands", hook: "hooks", instruction: "instructions" } as const;
  const rows: CustomizationLibraryRow[] = catalog.definitions.map((definition) => ({
    id: definition.id, category: categories[definition.kind], name: definition.name,
    description: definition.description,
    hosts: [...new Set([...catalog.exposures, ...catalog.registrations].filter((edge) => edge.definitionId === definition.id).map((edge) => edge.hostId))].sort(),
    source: definition.source.logicalPath, scope: definition.source.scope, evidence: definition.validation.status,
  }));
  for (const pkg of catalog.packages) {
    const installations = catalog.installations.filter((item) => item.packageId === pkg.id);
    if (installations.length === 0) rows.push({ id: pkg.id, category: "plugins", name: pkg.manifest.displayName ?? pkg.manifest.name, description: pkg.manifest.description, hosts: [], source: pkg.source.logicalPath, scope: pkg.source.scope, evidence: pkg.validation.status });
    for (const item of installations) rows.push({ id: item.id, category: "plugins", name: pkg.manifest.displayName ?? pkg.manifest.name, description: pkg.manifest.description, hosts: [item.hostId], source: item.source.logicalPath, scope: item.scope, evidence: item.enablement });
  }
  for (const discovery of catalog.runtimeObservations) {
    if (discovery.kind !== "mcp-server-discovery") continue;
    const registration = catalog.registrations.find((item) => item.id === discovery.registrationId);
    for (const tool of discovery.catalog) rows.push({ id: `${discovery.id}:${tool.id}`, category: "tools", name: tool.title ?? tool.name, description: tool.description, hosts: registration === undefined ? [] : [registration.hostId], source: registration?.source.logicalPath, scope: registration?.scope ?? "unknown", evidence: discovery.freshness });
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

export function filterCustomizationRows(rows: readonly CustomizationLibraryRow[], category: CustomizationCategory, host: string): CustomizationLibraryRow[] {
  return rows.filter((row) => (category === "overview" || row.category === category) && (host === "all" || (host === "unassigned" ? row.hosts.length === 0 : row.hosts.includes(host))));
}
