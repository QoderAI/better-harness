import type { ComponentType } from "react";
import type {
  ArtifactDescriptor,
  ArtifactHostedSelectionEventV1,
} from "../../contracts/artifact.js";

export interface ArtifactSurfaceMountContext {
  artifact: ArtifactDescriptor;
  liveGeneration: number;
  /** Host-validated semantic observation from this exact mounted surface. */
  onSelection?: (selection: ArtifactHostedSelectionEventV1) => void;
}

/** Composition contract for one browser-side Artifact renderer family. */
export interface ArtifactSurfaceMount {
  id: string;
  matches: (artifact: ArtifactDescriptor) => boolean;
  Component: ComponentType<ArtifactSurfaceMountContext>;
}

export type ArtifactSurfaceKind = "native" | "studio-sandbox" | "external-hosted" | "unavailable";
