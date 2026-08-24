import { useEffect, useState } from "react";
import {
  isArtifactDataSnapshot,
  type ArtifactDataSnapshot,
  type ArtifactDescriptor,
  type ArtifactSnapshotPayload,
} from "../../artifact-model.js";
import { studioApiError } from "../studio-api.js";

type PayloadKind = ArtifactSnapshotPayload["kind"];
type PayloadFor<K extends PayloadKind> = Extract<ArtifactSnapshotPayload, { kind: K }>;

export type ArtifactSnapshotFor<K extends PayloadKind> = Omit<ArtifactDataSnapshot, "payload"> & {
  payload: PayloadFor<K>;
};

export function isArtifactSnapshotFor<K extends PayloadKind>(
  value: unknown,
  artifact: ArtifactDescriptor,
  payloadKind: K,
): value is ArtifactSnapshotFor<K> {
  return isArtifactDataSnapshot(value)
    && value.artifactId === artifact.id
    && value.revisionId === artifact.revision.id
    && value.snapshotId === artifact.adapter.snapshotId
    && value.adapter.id === artifact.adapter.id
    && value.adapter.version === artifact.adapter.version
    && value.schemaId === artifact.adapter.schemaId
    && value.payload.kind === payloadKind;
}

/** Load and identity-check one exact, server-selected Artifact snapshot. */
export function useArtifactSnapshot<K extends PayloadKind>(
  artifact: ArtifactDescriptor,
  payloadKind: K,
  formatLabel: string,
): { snapshot?: ArtifactSnapshotFor<K>; failure?: string } {
  const [snapshot, setSnapshot] = useState<ArtifactSnapshotFor<K>>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setSnapshot(undefined);
    setFailure(undefined);
    void fetch(artifact.adapter.snapshotUri, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(await studioApiError(response));
      const value: unknown = await response.json();
      if (!isArtifactSnapshotFor(value, artifact, payloadKind)) {
        throw new Error(`${formatLabel} snapshot contract is unsupported.`);
      }
      if (active) setSnapshot(value);
    }).catch((error: unknown) => {
      if (active && !controller.signal.aborted) {
        setFailure(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    artifact.adapter.id,
    artifact.adapter.schemaId,
    artifact.adapter.snapshotId,
    artifact.adapter.snapshotUri,
    artifact.adapter.version,
    artifact.id,
    artifact.revision.id,
    formatLabel,
    payloadKind,
  ]);

  return { snapshot, failure };
}
