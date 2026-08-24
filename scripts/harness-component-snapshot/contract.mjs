import { createHash } from "node:crypto";

export const SNAPSHOT_KIND = "HarnessComponentSnapshotV1";
export const SNAPSHOT_SCHEMA_VERSION = 1;
export const DIFF_KIND = "HarnessComponentDiffV1";
export const DIFF_SCHEMA_VERSION = 1;
export const COMPONENT_KINDS = Object.freeze(["rule", "skill", "hook", "command", "workflow"]);
export const MAX_DIFF_LIMIT = 1000;
const POPULATION_REF_RE = /^hcp:qoder:project:sha256:[a-f0-9]{64}$/u;

export class HarnessComponentSnapshotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HarnessComponentSnapshotError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new HarnessComponentSnapshotError(code, message);
}

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalValue(value));
}

export function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function contentRevision(value) {
  return `sha256:${sha256(value)}`;
}

export function populationRefFromKey(key) {
  if (typeof key !== "string" || !key.trim() || key.length > 512 || key.includes("\0")) {
    fail("INVALID_POPULATION_KEY", "population key must be a non-empty opaque string of at most 512 characters");
  }
  const digest = sha256(`better-harness:harness-component-population:v1\0explicit\0${key.normalize("NFC")}`);
  return `hcp:qoder:project:sha256:${digest}`;
}

export function validatePopulationRef(value) {
  if (!POPULATION_REF_RE.test(String(value ?? ""))) {
    fail("INVALID_POPULATION_REF", "population reference is not a qoder project SHA-256 reference");
  }
  return value;
}

function isSha256(value) {
  return /^sha256:[a-f0-9]{64}$/u.test(String(value ?? ""));
}

function portableSegments(route) {
  const value = String(route ?? "").normalize("NFC").replaceAll("\\", "/");
  if (!value || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/u.test(value) || value.startsWith("//")) {
    fail("UNSAFE_COMPONENT_ROUTE", "component routes must be non-empty workspace-relative paths");
  }
  const segments = value.split("/").filter((segment) => segment && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    fail("UNSAFE_COMPONENT_ROUTE", "component routes cannot escape the workspace");
  }
  return segments;
}

export function normalizeComponentRoute(route) {
  return portableSegments(route).join("/");
}

export function encodeComponentRoute(route) {
  return portableSegments(route).map((segment) => encodeURIComponent(segment)).join("/");
}

export function artifactRefForRoute(route) {
  return `workspace:${encodeComponentRoute(route)}`;
}

export function componentIdFor({ provider, scope, populationRef, kind, route }) {
  if (provider !== "qoder") fail("UNSUPPORTED_PROVIDER", `unsupported snapshot provider: ${provider}`);
  if (scope !== "project") fail("UNSUPPORTED_SCOPE", `unsupported snapshot scope: ${scope}`);
  validatePopulationRef(populationRef);
  if (!COMPONENT_KINDS.includes(kind)) fail("UNSUPPORTED_COMPONENT_KIND", `unsupported component kind: ${kind}`);
  const populationDigest = populationRef.slice("hcp:qoder:project:sha256:".length);
  return `hcs:${provider}:${scope}:${populationDigest}:${kind}:${encodeComponentRoute(route)}`;
}

export function componentIdentityDigest(component) {
  return contentRevision(canonicalStringify({
    id: component.id,
    provider: component.provider,
    scope: component.scope,
    populationRef: component.populationRef,
    kind: component.kind,
    route: component.route,
  }));
}

export function rollbackReferenceFor(component) {
  return `harness-component:v1:${encodeURIComponent(component.id)}?revision=${encodeURIComponent(component.revision)}`;
}

export function parseRollbackReference(reference) {
  const prefix = "harness-component:v1:";
  const raw = String(reference ?? "");
  if (!raw.startsWith(prefix)) fail("INVALID_ROLLBACK_REFERENCE", "rollback reference has an unsupported scheme or version");
  const separator = raw.indexOf("?revision=", prefix.length);
  if (separator === -1) fail("INVALID_ROLLBACK_REFERENCE", "rollback reference is missing its revision");
  let componentId;
  let revision;
  try {
    componentId = decodeURIComponent(raw.slice(prefix.length, separator));
    revision = decodeURIComponent(raw.slice(separator + "?revision=".length));
  } catch {
    fail("INVALID_ROLLBACK_REFERENCE", "rollback reference encoding is invalid");
  }
  if (!componentId || !isSha256(revision)) {
    fail("INVALID_ROLLBACK_REFERENCE", "rollback reference component or revision is invalid");
  }
  const componentMatch = componentId.match(/^hcs:qoder:project:([a-f0-9]{64}):(rule|skill|hook|command|workflow):(.+)$/u);
  if (!componentMatch) {
    fail("INVALID_ROLLBACK_REFERENCE", "rollback reference component identity is invalid");
  }
  let route;
  try {
    route = componentMatch[3].split("/").map((segment) => decodeURIComponent(segment)).join("/");
  } catch {
    fail("INVALID_ROLLBACK_REFERENCE", "rollback reference component route encoding is invalid");
  }
  const populationRef = `hcp:qoder:project:sha256:${componentMatch[1]}`;
  if (componentIdFor({ provider: "qoder", scope: "project", populationRef, kind: componentMatch[2], route }) !== componentId) {
    fail("INVALID_ROLLBACK_REFERENCE", "rollback reference component identity is not canonical");
  }
  if (rollbackReferenceFor({ id: componentId, revision }) !== raw) {
    fail("INVALID_ROLLBACK_REFERENCE", "rollback reference is not canonically encoded");
  }
  return deepFreeze({ componentId, revision });
}

function snapshotPayload(snapshot) {
  return {
    kind: snapshot.kind,
    schemaVersion: snapshot.schemaVersion,
    provider: snapshot.provider,
    scope: snapshot.scope,
    populationRef: snapshot.populationRef,
    coverage: snapshot.coverage,
    components: snapshot.components,
    relationships: snapshot.relationships,
  };
}

export function snapshotDigestFor(snapshot) {
  return contentRevision(canonicalStringify(snapshotPayload(snapshot)));
}

function assertObject(value, code, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} must be an object`);
}

function assertExactKeys(value, keys, code, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    fail(code, `${label} fields do not match the v1 contract`);
  }
}

function validateComponent(component, snapshot) {
  assertObject(component, "INVALID_COMPONENT", "component");
  assertExactKeys(component, [
    "id", "provider", "scope", "populationRef", "kind", "route", "identityDigest", "revision",
    "activation", "provenance", "rollbackReference",
  ], "INVALID_COMPONENT", "component");
  if (component.provider !== snapshot.provider || component.scope !== snapshot.scope
    || component.populationRef !== snapshot.populationRef) {
    fail("COMPONENT_POPULATION_MISMATCH", `component ${component.id} does not belong to the snapshot population`);
  }
  const normalizedRoute = normalizeComponentRoute(component.route);
  if (normalizedRoute !== component.route) fail("NON_CANONICAL_COMPONENT_ROUTE", `component ${component.id} route is not canonical`);
  const expectedId = componentIdFor(component);
  if (component.id !== expectedId) fail("COMPONENT_ID_MISMATCH", `component identity does not match its fields: ${component.id}`);
  if (component.identityDigest !== componentIdentityDigest(component)) {
    fail("COMPONENT_IDENTITY_DIGEST_MISMATCH", `component identity digest is stale: ${component.id}`);
  }
  if (!isSha256(component.revision)) fail("INVALID_COMPONENT_REVISION", `component revision is invalid: ${component.id}`);

  assertObject(component.activation, "INVALID_ACTIVATION_EVIDENCE", `component ${component.id} activation`);
  assertExactKeys(component.activation, ["state", "evidenceState", "reason"], "INVALID_ACTIVATION_EVIDENCE", "activation");
  if (component.activation.state !== "unknown" || component.activation.evidenceState !== "unavailable"
    || component.activation.reason !== "runtime-observation-not-collected") {
    fail("INVALID_ACTIVATION_EVIDENCE", `component ${component.id} overstates activation evidence`);
  }

  assertObject(component.provenance, "INVALID_PROVENANCE", `component ${component.id} provenance`);
  assertExactKeys(component.provenance, ["state", "source", "artifactRef"], "INVALID_PROVENANCE", "provenance");
  const expectedProvenanceSource = component.kind === "workflow"
    ? "qoder-project-workflow-scan"
    : "qoder-project-inventory";
  if (component.provenance.state !== "observed" || component.provenance.source !== expectedProvenanceSource) {
    fail("INVALID_PROVENANCE", `component ${component.id} provenance is unsupported`);
  }
  const hookSuffix = /#hook\/[a-f0-9]{16}\/\d+$/u;
  if (component.kind === "hook" && !hookSuffix.test(component.route)) {
    fail("INVALID_HOOK_ROUTE", `component ${component.id} hook route is invalid`);
  }
  const artifactRoute = component.kind === "hook" ? component.route.replace(hookSuffix, "") : component.route;
  if (component.provenance.artifactRef !== artifactRefForRoute(artifactRoute)) {
    fail("PROVENANCE_ARTIFACT_MISMATCH", `component ${component.id} provenance does not match its route`);
  }
  const parsedRollback = parseRollbackReference(component.rollbackReference);
  if (parsedRollback.componentId !== component.id || parsedRollback.revision !== component.revision) {
    fail("ROLLBACK_REFERENCE_MISMATCH", `component ${component.id} rollback reference is stale`);
  }
}

function validateCoverage(snapshot) {
  if (!Array.isArray(snapshot.coverage) || snapshot.coverage.length !== COMPONENT_KINDS.length) {
    fail("INVALID_COVERAGE", "snapshot coverage must declare every v1 component kind");
  }
  const expected = COMPONENT_KINDS.map((kind) => ({
    kind,
    state: "observed",
    count: snapshot.components.filter((component) => component.kind === kind).length,
  }));
  if (canonicalStringify(snapshot.coverage) !== canonicalStringify(expected)) {
    fail("INVALID_COVERAGE", "snapshot coverage is stale or out of canonical order");
  }
}

// In v1 every relationship is exactly one `declared-in` edge per component, so
// the set is fully derivable from `components`. It stays a serialized, validated
// field because the typed relationship shape is the stable extension point for
// later relationship types; adding one must not be a breaking schema change.
function validateRelationships(snapshot) {
  if (!Array.isArray(snapshot.relationships)) fail("INVALID_RELATIONSHIPS", "snapshot relationships must be an array");
  const byId = new Map(snapshot.components.map((component) => [component.id, component]));
  for (const relationship of snapshot.relationships) {
    assertObject(relationship, "INVALID_RELATIONSHIP", "relationship");
    assertExactKeys(
      relationship,
      ["type", "sourceComponentId", "targetArtifactRef"],
      "INVALID_RELATIONSHIP",
      "relationship",
    );
    if (relationship.type !== "declared-in") {
      fail("UNSUPPORTED_RELATIONSHIP_TYPE", `unsupported relationship type: ${relationship.type}`);
    }
    if (!byId.has(relationship.sourceComponentId)) {
      fail("UNKNOWN_RELATIONSHIP_SOURCE", `unknown relationship source: ${relationship.sourceComponentId}`);
    }
    if (!String(relationship.targetArtifactRef).startsWith("workspace:")) {
      fail("UNSAFE_RELATIONSHIP_TARGET", "relationship targets must be workspace artifact references");
    }
  }
  const expected = snapshot.components.map((component) => ({
    type: "declared-in",
    sourceComponentId: component.id,
    targetArtifactRef: component.provenance.artifactRef,
  }));
  if (canonicalStringify(snapshot.relationships) !== canonicalStringify(expected)) {
    fail("INVALID_RELATIONSHIPS", "snapshot relationships are stale or out of canonical order");
  }
}

export function validateHarnessComponentSnapshot(snapshot) {
  assertObject(snapshot, "INVALID_SNAPSHOT", "snapshot");
  assertExactKeys(snapshot, [
    "kind", "schemaVersion", "provider", "scope", "populationRef", "coverage", "components", "relationships", "snapshotDigest",
  ], "INVALID_SNAPSHOT", "snapshot");
  if (snapshot.kind !== SNAPSHOT_KIND || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    fail("UNSUPPORTED_SNAPSHOT_VERSION", "snapshot kind or schema version is unsupported");
  }
  if (snapshot.provider !== "qoder" || snapshot.scope !== "project") {
    fail("UNSUPPORTED_SNAPSHOT_POPULATION", "v1 supports only qoder project snapshots");
  }
  validatePopulationRef(snapshot.populationRef);
  if (!Array.isArray(snapshot.components)) fail("INVALID_COMPONENTS", "snapshot components must be an array");
  const sortedIds = snapshot.components.map((component) => component.id).sort(compareCodeUnits);
  const actualIds = snapshot.components.map((component) => component.id);
  if (new Set(actualIds).size !== actualIds.length) fail("DUPLICATE_COMPONENT_ID", "snapshot component IDs must be unique");
  if (canonicalStringify(actualIds) !== canonicalStringify(sortedIds)) {
    fail("NON_CANONICAL_COMPONENT_ORDER", "snapshot components are not in canonical order");
  }
  for (const component of snapshot.components) validateComponent(component, snapshot);
  validateCoverage(snapshot);
  validateRelationships(snapshot);
  const expectedDigest = snapshotDigestFor(snapshot);
  if (snapshot.snapshotDigest !== expectedDigest) fail("SNAPSHOT_DIGEST_MISMATCH", "snapshot content does not match its digest");
  return snapshot;
}
