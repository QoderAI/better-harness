import type { ArtifactSurfaceMountContext } from "./ArtifactSurface.js";

/** Security boundary for server-hosted Provider documents. */
export function ExternalHostedArtifactView({ artifact }: ArtifactSurfaceMountContext): React.JSX.Element {
  const viewUri = artifact.renderer.viewUri;
  if (viewUri === undefined) {
    return <p className="artifact-status" role="alert">The hosted Artifact surface has no view URI.</p>;
  }
  return <iframe
    className="artifact-frame"
    title={`Artifact preview: ${artifact.label}`}
    src={viewUri}
    sandbox="allow-scripts"
    referrerPolicy="no-referrer"
  />;
}
