import type { ArtifactSurfaceMountContext } from "./ArtifactSurface.js";

export function ImageArtifactView({ artifact }: ArtifactSurfaceMountContext): React.JSX.Element {
  return <div className="artifact-image-stage">
    <img src={artifact.revision.content.uri} alt={artifact.label} />
  </div>;
}
