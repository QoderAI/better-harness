import {
  DIFF_KIND,
  DIFF_SCHEMA_VERSION,
  MAX_DIFF_LIMIT,
  canonicalStringify,
  compareCodeUnits,
  contentRevision,
  deepFreeze,
  fail,
  validateHarnessComponentSnapshot,
} from "./contract.mjs";

// Significant statuses come first so a small limit truncates redundant
// `unchanged` entries instead of hiding the actual differences. Ordering stays
// deterministic because ties fall back to the canonical component ID order.
const STATUS_ORDER = Object.freeze(["changed", "added", "removed", "unchanged"]);

function compareEntries(left, right) {
  const statusDelta = STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status);
  return statusDelta || compareCodeUnits(left.componentId, right.componentId);
}

function boundedLimit(value) {
  const limit = value === undefined ? 200 : Number(value);
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_DIFF_LIMIT) {
    fail("INVALID_DIFF_LIMIT", `diff limit must be an integer from 0 to ${MAX_DIFF_LIMIT}`);
  }
  return limit;
}

function dimensions(before, after) {
  const changed = [];
  if (before.revision !== after.revision) changed.push("content");
  return changed;
}

function entryFor(componentId, before, after) {
  if (!before) return { componentId, status: "added", afterRevision: after.revision };
  if (!after) return { componentId, status: "removed", beforeRevision: before.revision };
  const changedDimensions = dimensions(before, after);
  if (changedDimensions.length === 0) {
    return { componentId, status: "unchanged", revision: before.revision };
  }
  return {
    componentId,
    status: "changed",
    changedDimensions,
    beforeRevision: before.revision,
    afterRevision: after.revision,
  };
}

export function diffHarnessComponentSnapshots(before, after, options = {}) {
  validateHarnessComponentSnapshot(before);
  validateHarnessComponentSnapshot(after);
  if (before.provider !== after.provider || before.scope !== after.scope
    || before.populationRef !== after.populationRef) {
    fail("SNAPSHOT_POPULATION_MISMATCH", "snapshots must have the same provider, scope, and population reference");
  }
  const limit = boundedLimit(options.limit);
  const beforeById = new Map(before.components.map((component) => [component.id, component]));
  const afterById = new Map(after.components.map((component) => [component.id, component]));
  const componentIds = [...new Set([...beforeById.keys(), ...afterById.keys()])]
    .sort(compareCodeUnits);
  const allEntries = componentIds.map((componentId) => entryFor(
    componentId,
    beforeById.get(componentId),
    afterById.get(componentId),
  )).sort(compareEntries);
  const counts = Object.fromEntries(["added", "removed", "changed", "unchanged"]
    .map((status) => [status, allEntries.filter((entry) => entry.status === status).length]));
  const diff = {
    kind: DIFF_KIND,
    schemaVersion: DIFF_SCHEMA_VERSION,
    provider: before.provider,
    scope: before.scope,
    populationRef: before.populationRef,
    beforeSnapshotDigest: before.snapshotDigest,
    afterSnapshotDigest: after.snapshotDigest,
    counts,
    limit,
    totalEntries: allEntries.length,
    truncated: allEntries.length > limit,
    entries: allEntries.slice(0, limit),
    diffDigest: "",
  };
  diff.diffDigest = contentRevision(canonicalStringify({ ...diff, diffDigest: undefined }));
  return deepFreeze(diff);
}
