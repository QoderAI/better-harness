import { createHash } from "node:crypto";
import { canonicalArtifactInteractionJson } from "../../contracts/artifact.js";
import type { HarnessStudioState } from "../studio-types.js";

/** Stable identity for the currently selected Artifact catalog authority. */
export function artifactAuthorityId(state: HarnessStudioState): string {
  return `sha256:${createHash("sha256").update(canonicalArtifactInteractionJson([
    state.artifactDirectory ?? null,
    state.artifactPaths ?? null,
    state.activeProjectId ?? null,
    state.projectRevision,
  ])).digest("hex")}`;
}
