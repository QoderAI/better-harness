import type { ArtifactCatalogResponse } from "./artifact-model.js";

export const WORKSPACE_ARTIFACT_NAVIGATION_KIND = "HarnessStudioWorkspaceArtifactNavigationV1" as const;

/** Privacy-safe evidence tying a current workspace file to one retained Session. */
export interface WorkspaceArtifactObservation {
  artifactId: string;
  sessionId: string;
  savedAt: string;
  prompt: string;
  provider?: string;
}

export interface WorkspaceArtifactNavigation {
  kind: typeof WORKSPACE_ARTIFACT_NAVIGATION_KIND;
  workspaceLabel: string;
  observations: WorkspaceArtifactObservation[];
}

/**
 * Studio may add navigation context around the host-neutral Artifact catalog.
 * The base response stays independently valid for SDK and compatibility clients.
 */
export type StudioArtifactCatalogResponse = ArtifactCatalogResponse & {
  navigation?: WorkspaceArtifactNavigation;
};

export function isWorkspaceArtifactNavigation(value: unknown): value is WorkspaceArtifactNavigation {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === WORKSPACE_ARTIFACT_NAVIGATION_KIND
    && typeof candidate.workspaceLabel === "string"
    && Array.isArray(candidate.observations)
    && candidate.observations.every((observation) => {
      if (observation === null || typeof observation !== "object") return false;
      const row = observation as Record<string, unknown>;
      return typeof row.artifactId === "string"
        && typeof row.sessionId === "string"
        && typeof row.savedAt === "string"
        && Number.isFinite(Date.parse(row.savedAt))
        && typeof row.prompt === "string"
        && (row.provider === undefined || typeof row.provider === "string");
    });
}
