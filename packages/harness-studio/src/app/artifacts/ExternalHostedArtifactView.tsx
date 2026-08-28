import { useEffect, useRef } from "react";
import type {
  ArtifactDescriptor,
  ArtifactHostedSelectionEventV1,
} from "../../contracts/artifact.js";
import type { ArtifactSurfaceMountContext } from "./ArtifactSurface.js";

/** Security boundary for server-hosted Provider documents. */
export function ExternalHostedArtifactView({ artifact, onSelection }: ArtifactSurfaceMountContext): React.JSX.Element {
  const viewUri = artifact.renderer.viewUri;
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (onSelection === undefined) return;
    const receive = (event: MessageEvent<unknown>): void => {
      const selection = hostedArtifactSelectionFromFrame(event, frameRef.current?.contentWindow ?? null, artifact);
      if (selection !== undefined) onSelection(selection);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [artifact, onSelection]);
  if (viewUri === undefined) {
    return <p className="artifact-status" role="alert">The hosted Artifact surface has no view URI.</p>;
  }
  return <iframe
    ref={frameRef}
    className="artifact-frame"
    title={`Artifact preview: ${artifact.label}`}
    src={viewUri}
    sandbox="allow-scripts"
    referrerPolicy="no-referrer"
  />;
}

/** Reject observations from unrelated windows before decoding Provider data. */
export function hostedArtifactSelectionFromFrame(
  event: Pick<MessageEvent<unknown>, "data" | "source">,
  frameWindow: Window | null,
  artifact: ArtifactDescriptor,
): ArtifactHostedSelectionEventV1 | undefined {
  return frameWindow !== null && event.source === frameWindow
    ? hostedArtifactSelection(event.data, artifact)
    : undefined;
}

/** Resolve an iframe observation only against the exact Host-selected binding. */
export function hostedArtifactSelection(
  value: unknown,
  artifact: ArtifactDescriptor,
): ArtifactHostedSelectionEventV1 | undefined {
  if (artifact.interaction === undefined || artifact.renderer.bindingId === undefined
    || value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const message = value as Record<string, unknown>;
  if (message.kind !== "HarnessStudioArtifactHostedSelectionV1" || message.protocolVersion !== "1"
    || message.artifactId !== artifact.id || message.revision !== artifact.revision.id
    || message.bindingId !== artifact.renderer.bindingId || typeof message.address !== "string"
    || message.address.trim() === "" || message.address.length > 8_192) return undefined;
  return {
    kind: message.kind,
    protocolVersion: message.protocolVersion,
    artifactId: message.artifactId,
    revision: message.revision,
    bindingId: message.bindingId,
    address: message.address,
  };
}
