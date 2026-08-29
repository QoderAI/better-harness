import { useTranslation } from "react-i18next";
import {
  ARTIFACT_SURFACE_MOUNTS,
  resolveArtifactSurfaceMount,
} from "./ArtifactSurfaceRegistry.js";
import type {
  ArtifactSurfaceMount,
  ArtifactSurfaceMountContext,
} from "./ArtifactSurface.js";
import type { ArtifactDescriptor } from "../../contracts/artifact.js";

export {
  ARTIFACT_SURFACE_MOUNTS,
  normalizeArtifactSurfaceKind,
  resolveArtifactSurfaceMount,
} from "./ArtifactSurfaceRegistry.js";
export type {
  ArtifactSurfaceKind,
  ArtifactSurfaceMount,
  ArtifactSurfaceMountContext,
} from "./ArtifactSurface.js";

/** @deprecated V2 source compatibility; new code uses Artifact Surface terminology. */
export type ArtifactViewProviderContext = ArtifactSurfaceMountContext;
/** @deprecated V2 source compatibility; new code uses Artifact Surface terminology. */
export type ArtifactViewProvider = ArtifactSurfaceMount;
/** @deprecated V2 source compatibility; new code uses Artifact Surface terminology. */
export const ARTIFACT_VIEW_PROVIDERS = ARTIFACT_SURFACE_MOUNTS;
/** @deprecated V2 source compatibility; new code uses Artifact Surface terminology. */
export const resolveArtifactViewProvider = resolveArtifactSurfaceMount;

export interface ArtifactViewHostProps extends ArtifactSurfaceMountContext {
  /** Identity of the catalog authority that selected this artifact binding. */
  authorityId: string;
}

/** Host-owned dispatch; the server-selected renderer remains authoritative. */
export function ArtifactView(props: ArtifactViewHostProps): React.JSX.Element {
  const { t } = useTranslation("artifactViewers");
  if (props.artifact.renderer.status === "ready") {
    const mount = resolveArtifactSurfaceMount(props.artifact);
    if (mount !== undefined) {
      const Component = mount.Component;
      const key = artifactSurfaceInstanceKey(mount, props.authorityId, props.artifact);
      return <Component
        key={key}
        artifact={props.artifact}
        liveGeneration={props.liveGeneration}
        onSelection={props.onSelection}
        onIntentOutcome={props.onIntentOutcome}
        onIntentFailure={props.onIntentFailure}
      />;
    }
  }
  return <p className="artifact-status" role="status">{props.artifact.renderer.reason ?? t("noRenderer", { id: props.artifact.renderer.id })}</p>;
}

/** Retain content revisions only while the selecting authority and binding agree. */
export function artifactSurfaceInstanceKey(
  mount: ArtifactSurfaceMount,
  authorityId: string,
  artifact: ArtifactDescriptor,
): string {
  if (artifact.renderer.bindingId !== undefined) {
    return [mount.id, authorityId, artifact.id, artifact.renderer.bindingId].join(":");
  }
  return [
    mount.id,
    authorityId,
    artifact.id,
    artifact.revision.digest,
    artifact.adapter.snapshotId,
    artifact.renderer.provider,
    artifact.renderer.id,
    artifact.renderer.type,
    artifact.renderer.viewUri ?? "",
  ].join(":");
}
