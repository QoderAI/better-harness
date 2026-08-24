/**
 * Revision integrity: the guarantees that make a `HarnessRevision` an
 * execution closure rather than a label.
 *
 * A revision records content hashes for the harness, its workflow, and every
 * resolved capability. Those hashes are only worth something if somebody
 * recomputes them, so every execution path validates:
 *
 * - the revision still hashes to its own `revisionId` (nobody mutated it), and
 * - the bundle an executor was handed is the bundle the revision was resolved
 *   from (nobody swapped the run content behind the id).
 *
 * The same tamper-safe posture the repository already applies to
 * `HarnessComponentSnapshotV1`: deep freeze, digest recomputation, and an
 * explicit mismatch error instead of a silent best effort.
 */
import { canonicalJson, contentHash, sha256Hex } from "./canonical.js";
import { findCapability, type HarnessIrBundle, type HarnessRevision } from "./index.js";
import type { AdapterRealizationDescriptor } from "../resolver/adapter-descriptor.js";

export class HarnessRevisionTamperedError extends Error {
  constructor(
    readonly revisionId: string,
    readonly recomputedRevisionId: string,
  ) {
    super(
      `Harness revision '${revisionId}' no longer hashes to its own content ` +
        `(recomputed '${recomputedRevisionId}'). The revision was mutated after resolution.`,
    );
    this.name = "HarnessRevisionTamperedError";
  }
}

export class HarnessRevisionBundleMismatchError extends Error {
  constructor(
    readonly revisionId: string,
    readonly mismatches: readonly string[],
  ) {
    super(
      `Harness revision '${revisionId}' does not match the supplied IR bundle: ` +
        `${mismatches.join("; ")}. Execute the bundle the revision was resolved from.`,
    );
    this.name = "HarnessRevisionBundleMismatchError";
  }
}

export class HarnessAdapterMismatchError extends Error {
  constructor(
    readonly revisionAdapter: string,
    readonly adapterId: string,
    detail?: string,
  ) {
    super(
      `Harness revision targets adapter '${revisionAdapter}', but adapter '${adapterId}' ` +
        `was asked to run it.${detail === undefined ? "" : ` ${detail}`}`,
    );
    this.name = "HarnessAdapterMismatchError";
  }
}

export class HarnessSourceLockError extends Error {
  constructor(
    readonly revisionId: string,
    readonly drifted: readonly string[],
  ) {
    super(
      `Harness revision '${revisionId}' locked capability sources that changed on disk: ` +
        `${drifted.join("; ")}.`,
    );
    this.name = "HarnessSourceLockError";
  }
}

export type HarnessRevisionBody = Omit<HarnessRevision, "revisionId">;

/** The single definition of a revision id; the resolver and every validator share it. */
export function computeRevisionId(body: HarnessRevisionBody): string {
  return `hr_${sha256Hex(canonicalJson(body)).slice(0, 32)}`;
}

/** Recompute the revision id and reject a revision mutated after resolution. */
export function assertRevisionIntegrity(revision: HarnessRevision): void {
  const { revisionId, ...body } = revision;
  const recomputed = computeRevisionId(body);
  if (recomputed !== revisionId) {
    throw new HarnessRevisionTamperedError(revisionId, recomputed);
  }
}

/**
 * Reject a revision/bundle pair that does not belong together.
 *
 * Without this check an executor happily reads workflow graphs and skill
 * descriptions out of a second bundle while reporting the first bundle's
 * `revisionId`, which makes every downstream evidence claim unfalsifiable.
 */
export function validateRevisionAgainstBundle(
  revision: HarnessRevision,
  bundle: HarnessIrBundle,
): void {
  assertRevisionIntegrity(revision);
  const mismatches: string[] = [];

  const harness = bundle.harnesses.find((candidate) => candidate.id === revision.harness.id);
  if (!harness) {
    mismatches.push(`harness '${revision.harness.id}' is absent`);
  } else if (contentHash(harness) !== revision.harness.contentHash) {
    mismatches.push(`harness '${revision.harness.id}' content changed`);
  }

  const deployment = bundle.deployments.find(
    (candidate) => candidate.id === revision.deployment.id,
  );
  if (!deployment) {
    mismatches.push(`deployment '${revision.deployment.id}' is absent`);
  } else if (contentHash(deployment) !== revision.deployment.contentHash) {
    mismatches.push(`deployment '${revision.deployment.id}' content changed`);
  }

  const workflow = bundle.workflows.find((candidate) => candidate.id === revision.workflow.id);
  if (!workflow) {
    mismatches.push(`workflow '${revision.workflow.id}' is absent`);
  } else if (contentHash(workflow) !== revision.workflow.contentHash) {
    mismatches.push(`workflow '${revision.workflow.id}' content changed`);
  }

  for (const locked of revision.resolved.capabilities) {
    const capability = findCapability(bundle, locked.id);
    if (!capability) {
      mismatches.push(`${locked.kind} '${locked.id}' is absent`);
      continue;
    }
    if (capability.kind !== locked.kind) {
      mismatches.push(`'${locked.id}' is a ${capability.kind}, not a ${locked.kind}`);
      continue;
    }
    if (contentHash(capability) !== locked.contentHash) {
      mismatches.push(`${locked.kind} '${locked.id}' content changed`);
    }
  }

  if (mismatches.length > 0) {
    throw new HarnessRevisionBundleMismatchError(revision.revisionId, mismatches);
  }
}

/** Reject an adapter package that is not the one the revision resolved against. */
export function assertRevisionAdapter(
  revision: HarnessRevision,
  descriptor: AdapterRealizationDescriptor,
): void {
  if (revision.target.adapter !== descriptor.adapterId) {
    throw new HarnessAdapterMismatchError(revision.target.adapter, descriptor.adapterId);
  }
  const descriptorHash = contentHash(descriptor);
  if (
    revision.target.adapterSpecificationVersion !== descriptor.specificationVersion ||
    revision.target.adapterImplementationVersion !== descriptor.implementationVersion ||
    revision.target.adapterDescriptorHash !== descriptorHash
  ) {
    throw new HarnessAdapterMismatchError(
      revision.target.adapter,
      descriptor.adapterId,
      `The revision locked adapter contract ${revision.target.adapterSpecificationVersion}/` +
        `${revision.target.adapterImplementationVersion} (${revision.target.adapterDescriptorHash}), ` +
        `but this adapter reports ${descriptor.specificationVersion}/${descriptor.implementationVersion} ` +
        `(${descriptorHash}).`,
    );
  }
}

/** Freeze a resolved artifact so a caller cannot edit it between resolve and run. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }
  return value;
}
