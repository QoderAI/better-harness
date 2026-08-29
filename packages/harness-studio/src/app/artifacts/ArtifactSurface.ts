import type { ComponentType } from "react";
import type {
  ArtifactDescriptor,
  ArtifactHostedIntentOutcomeV1,
  ArtifactHostedSelectionEventV1,
} from "../../contracts/artifact.js";

export interface ArtifactHostedIntentFailure {
  artifactId: string;
  revision: string;
  bindingId: string;
  intentId: string;
  requestSequence: number;
  message: string;
}

export interface ArtifactSurfaceMountContext {
  artifact: ArtifactDescriptor;
  liveGeneration: number;
  /** Host-validated semantic observation from this exact mounted surface. */
  onSelection?: (selection: ArtifactHostedSelectionEventV1) => void;
  /** Host-recorded intent outcome from this exact mounted surface. */
  onIntentOutcome?: (outcome: ArtifactHostedIntentOutcomeV1) => void;
  /** Friendly failure state only; Provider/server internals stay outside the iframe boundary. */
  onIntentFailure?: (failure: ArtifactHostedIntentFailure) => void;
}

/** Composition contract for one browser-side Artifact renderer family. */
export interface ArtifactSurfaceMount {
  id: string;
  matches: (artifact: ArtifactDescriptor) => boolean;
  Component: ComponentType<ArtifactSurfaceMountContext>;
}

export type ArtifactSurfaceKind = "native" | "studio-sandbox" | "external-hosted" | "unavailable";
