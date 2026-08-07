import {
  deepFreeze,
  fail,
  parseRollbackReference,
  validateHarnessComponentSnapshot,
} from "./contract.mjs";

export function resolveHarnessComponentRollbackReference(snapshot, reference) {
  validateHarnessComponentSnapshot(snapshot);
  const parsed = parseRollbackReference(reference);
  const component = snapshot.components.find((candidate) => candidate.id === parsed.componentId);
  if (!component) fail("ROLLBACK_COMPONENT_NOT_FOUND", "rollback reference does not resolve in this snapshot");
  if (component.revision !== parsed.revision || component.rollbackReference !== reference) {
    fail("ROLLBACK_REVISION_MISMATCH", "rollback reference revision does not match this snapshot");
  }
  return deepFreeze({
    kind: "HarnessComponentRollbackResolutionV1",
    schemaVersion: 1,
    snapshotDigest: snapshot.snapshotDigest,
    componentId: component.id,
    revision: component.revision,
    artifactRef: component.provenance.artifactRef,
    resolved: true,
    mutationAuthorized: false,
    mutationReason: "snapshot-reference-does-not-authorize-restore",
  });
}
