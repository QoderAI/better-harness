import type { CustomizationCatalogV1 } from "@qoder-ai/harness/customization";
import type { CustomizationUsageV1 } from "../contracts/customization-usage.js";

export const CUSTOMIZATION_CATEGORIES = ["plugins", "mcp", "skills", "instructions", "agents", "hooks", "tools", "commands"] as const;
export type CustomizationCategory = typeof CUSTOMIZATION_CATEGORIES[number];

/**
 * The category a Customizations route lands on when none is named. The catalog is
 * navigated by kind from the primary sidebar, so there is no aggregate row left to
 * default to.
 */
export const CUSTOMIZATION_DEFAULT_CATEGORY: CustomizationCategory = "plugins";

export function isCustomizationCategory(value: string | undefined): value is CustomizationCategory {
  return value !== undefined && (CUSTOMIZATION_CATEGORIES as readonly string[]).includes(value);
}

export interface CustomizationLibraryRow {
  id: string;
  category: CustomizationCategory;
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
  return rows.filter((row) => row.category === category && (host === "all" || (host === "unassigned" ? row.hosts.length === 0 : row.hosts.includes(host))));
}

/** One Agent row in the secondary sidebar: `all`, a collected Host, or `unassigned`. */
export interface CustomizationAgentFacet {
  id: string;
  /** Absent for `all` and `unassigned`, whose names are Studio's own copy. */
  label?: string;
  /** The Host's collection status, carried only when it was not a clean collection. */
  status?: string;
  count: number;
}

/**
 * The Agent dimension as rows rather than a menu: every Host the catalog observed
 * keeps its place in the list even when the selected category holds none of its
 * entries, because a zero beside a Host that collected is evidence and a missing
 * row is not. `unassigned` appears only when some entry really has no Agent edge.
 */
export function customizationAgentFacets(options: {
  rows: readonly CustomizationLibraryRow[];
  category: CustomizationCategory;
  hosts: readonly { id: string; label: string; status: string }[];
}): CustomizationAgentFacet[] {
  const { rows, category, hosts } = options;
  const count = (host: string): number => filterCustomizationRows(rows, category, host).length;
  const observed = [...new Set([...hosts.map((host) => host.id), ...rows.flatMap((row) => row.hosts)])].sort();
  return [
    { id: "all", count: count("all") },
    ...observed.map((id) => {
      const host = hosts.find((item) => item.id === id);
      return {
        id,
        ...(host === undefined ? {} : { label: host.label }),
        ...(host === undefined || host.status === "ok" ? {} : { status: host.status }),
        count: count(id),
      };
    }),
    ...(rows.some((row) => row.hosts.length === 0) ? [{ id: "unassigned", count: count("unassigned") }] : []),
  ];
}

/**
 * The text filter is the last stage, after category and Agent, so the counts a
 * reader navigates by keep describing the catalog rather than the search box. It
 * matches the three fields a row actually shows.
 */
export function searchCustomizationRows(rows: readonly CustomizationLibraryRow[], query: string): CustomizationLibraryRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter((row) => [row.name, row.description, row.source].some((value) => value?.toLowerCase().includes(needle) === true));
}

/** Categories whose entries a Session can be observed invoking. */
const USAGE_CATEGORIES = { skills: "skill", mcp: "mcp-server" } as const;

export interface CustomizationRowUsage {
  count: number;
  lastObservedAt?: string;
}

/**
 * Whether this category can carry an observation at all. A column of dashes over
 * Instructions or Hooks would claim Studio looked and found nothing, when no rule
 * for observing them exists.
 */
export function customizationUsageObservable(category: CustomizationCategory): boolean {
  return category in USAGE_CATEGORIES;
}

/**
 * The definition-name side of the matching rule owned by
 * `scripts/session-analysis/customization-usage.mjs`, which normalizes the observed
 * name before it leaves the server. Both sides must reduce to the same form, so
 * this repeats the rule rather than importing a Node-only script into the bundle.
 */
export function normalizeCustomizationUsageName(value: string): string {
  const text = value.trim().toLowerCase();
  return text.split(/[:/\\]/u).filter(Boolean).at(-1) ?? "";
}

/**
 * The observed invocations for one row, or `undefined` when none were observed.
 *
 * A count is only read for the Hosts the row is actually exposed to, and the Agent
 * filter narrows it further, so the number always answers the question the reader
 * has on screen. `undefined` means not observed — never proof of an unused
 * definition, which is why the caller must not render it as `0`.
 */
export function customizationRowUsage(
  row: CustomizationLibraryRow,
  usage: CustomizationUsageV1 | undefined,
  agent: string,
): CustomizationRowUsage | undefined {
  const kind = USAGE_CATEGORIES[row.category as keyof typeof USAGE_CATEGORIES];
  if (kind === undefined || usage === undefined) return undefined;
  const name = normalizeCustomizationUsageName(row.name);
  const hosts = agent === "all" || agent === "unassigned" ? row.hosts : row.hosts.filter((host) => host === agent);
  if (name === "" || hosts.length === 0) return undefined;
  let count = 0;
  let lastObservedAt: string | undefined;
  for (const entry of usage.entries) {
    if (entry.kind !== kind || entry.name !== name || !hosts.includes(entry.hostId)) continue;
    count += entry.count;
    if (entry.lastObservedAt !== undefined && (lastObservedAt === undefined || entry.lastObservedAt > lastObservedAt)) {
      lastObservedAt = entry.lastObservedAt;
    }
  }
  return count === 0 ? undefined : { count, ...(lastObservedAt === undefined ? {} : { lastObservedAt }) };
}
