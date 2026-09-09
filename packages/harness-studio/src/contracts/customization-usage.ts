/**
 * Observed invocation counts for customization definitions.
 *
 * This is a Studio-owned runtime observation, deliberately beside the
 * customization catalog rather than inside it. The catalog states what a Host has
 * configured; this states what retained Session evidence saw run, matched to a
 * definition by name within one Host. A missing entry means the invocation was
 * not observed in the stated window — never that the definition is unused.
 */
export const CUSTOMIZATION_USAGE_KIND = "BetterHarnessCustomizationUsageV1" as const;

export type CustomizationUsageEntryKind = "skill" | "mcp-server";

export interface CustomizationUsageEntryV1 {
  kind: CustomizationUsageEntryKind;
  /** The Host whose Session produced the observation. */
  hostId: string;
  /** Normalized definition name: lower-case, last `:`/`/` segment. */
  name: string;
  count: number;
  lastObservedAt?: string;
}

export interface CustomizationUsageV1 {
  kind: typeof CUSTOMIZATION_USAGE_KIND;
  schemaVersion: number;
  /** Sessions read for this aggregate, including those that invoked nothing. */
  observedSessions: number;
  /** The span the observed Sessions cover, or nulls when no timestamp was retained. */
  window: { from: string | null; to: string | null };
  entries: CustomizationUsageEntryV1[];
}
