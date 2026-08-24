import type { ComponentType } from "react";
import type { ArtifactDescriptor } from "../../artifact-model.js";

export interface ArtifactSurfaceMountContext {
  artifact: ArtifactDescriptor;
  liveGeneration: number;
}

/** Composition contract for one browser-side Artifact renderer family. */
export interface ArtifactSurfaceMount {
  id: string;
  matches: (artifact: ArtifactDescriptor) => boolean;
  Component: ComponentType<ArtifactSurfaceMountContext>;
}

export type ArtifactSurfaceKind = "native" | "studio-sandbox" | "external-hosted" | "unavailable";
