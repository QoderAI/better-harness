export const HOST_SUPPORT_SCHEMA_VERSION = "1";
export const HOST_DISTRIBUTION_KINDS = Object.freeze(["marketplace", "bundled", "source-local", "extension", "package"]);
export const HOST_SCOPES = Object.freeze(["user", "project", "local", "session", "bundled"]);
export const HOST_OBSERVATION_KINDS = Object.freeze(["inventory", "bundled", "session-only", "desktop-cache"]);
export const HOST_DISCOVERY_SOURCES = Object.freeze(["executable", "diagnostic", "unobserved"]);
export const HOST_SCOPE_ARTIFACT_POLICIES = Object.freeze(["independent", "shared"]);
export const NATIVE_HOME_BINDING_KINDS = Object.freeze(["environment"]);
export const LIFECYCLE_DISPOSITIONS = Object.freeze(["supported", "manual", "not-applicable", "unavailable"]);
export const LIFECYCLE_OPERATION_NAMES = Object.freeze(["install", "update", "remove", "verify"]);
export const LIFECYCLE_STEP_KINDS = Object.freeze(["shell", "manual", "host-command", "desktop-ui"]);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function assertNonEmptyString(value, message) {
  assert(typeof value === "string" && value.length > 0, message);
}

function assertIdentifier(value, label) {
  assert(/^[a-z][a-z0-9-]*$/u.test(value), `Invalid ${label}: ${value}`);
}

function assertStringArray(values, message, { nonEmpty = false } = {}) {
  assert(Array.isArray(values), message);
  if (nonEmpty) assert(values.length > 0, message);
  assert(values.every((value) => typeof value === "string" && value.length > 0), message);
}

function isRedactedInventoryFallback(value) {
  if (value === "~" || /^<provider-default:[a-z][A-Za-z0-9]*>$/u.test(value)) return true;
  const match = value.match(/^(?:~|<[a-z][a-z0-9-]*>)\/(.+)$/u);
  if (!match) return false;
  const segments = match[1].split("/");
  return segments.length > 0 && segments.every((segment) => (
    segment !== "."
    && segment !== ".."
    && /^[A-Za-z0-9._-]+$/u.test(segment)
  ));
}

function validateInventoryHomeRoutes(profile) {
  const routes = profile.inventoryHomeRoutes;
  assert(Array.isArray(routes) && routes.length > 0, `Host has no inventory home routes: ${profile.hostId}`);
  const options = new Set();
  for (const route of routes) {
    assert(route && typeof route === "object" && !Array.isArray(route), `Invalid inventory home route: ${profile.hostId}`);
    assert(
      typeof route.option === "string" && /^[a-z][A-Za-z0-9]*$/u.test(route.option),
      `Invalid inventory home route option: ${profile.hostId}`,
    );
    assert(!options.has(route.option), `Duplicate inventory home route option: ${profile.hostId}/${route.option}`);
    options.add(route.option);
    assert(typeof route.relativePath === "string", `Invalid inventory home route path: ${profile.hostId}/${route.option}`);
    assertNonEmptyString(route.fallbackLabel, `Invalid inventory home route fallback: ${profile.hostId}/${route.option}`);
    assert(
      isRedactedInventoryFallback(route.fallbackLabel),
      `Inventory home route fallback must be redacted: ${profile.hostId}/${route.option}`,
    );
    const segments = route.relativePath.split(/[\\/]/u);
    assert(
      !/^(?:[\\/]|[A-Za-z]:)/u.test(route.relativePath) && !segments.includes(".."),
      `Inventory home route must stay inside the isolated root: ${profile.hostId}/${route.option}`,
    );
  }
  assert(
    routes.some((route) => route.option === profile.inventoryHomeOption && route.relativePath === ""),
    `Primary inventory home route is missing: ${profile.hostId}`,
  );
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function validateContractEvidence(record, label = "lifecycle operation") {
  assert(record && typeof record === "object", `${label} lacks evidence; contract evidence is required.`);
  assertNonEmptyString(record.id, `${label} has invalid contract evidence id.`);
  assertNonEmptyString(record.kind, `${label} has invalid contract evidence kind.`);
  assert(/^\d{4}-\d{2}-\d{2}$/u.test(record.observedAt), `${label} has invalid contract evidence date.`);
  assertNonEmptyString(record.fixture, `${label} has invalid contract evidence fixture.`);
  return true;
}

export function validateLifecycleStep(step, label = "lifecycle step") {
  assert(step && typeof step === "object", `${label} must be an object.`);
  assert(LIFECYCLE_STEP_KINDS.includes(step.kind), `Invalid step kind for ${label}.`);
  assertNonEmptyString(step.expected, `${label} lacks an expected result.`);
  const representations = [step.argv, step.command, step.instruction]
    .filter((value) => value != null);
  assert(representations.length === 1, `${label} must have exactly one typed instruction.`);
  if (step.kind === "shell") {
    assert(Array.isArray(step.argv) && step.argv.length > 0, `${label} shell step requires a non-empty argv array.`);
    assert(step.argv.every((argument) => typeof argument === "string"), `${label} shell argv must contain only strings.`);
  } else if (step.kind === "host-command") {
    assertNonEmptyString(step.command, `${label} host command is missing.`);
  } else {
    assertNonEmptyString(step.instruction, `${label} instruction is missing.`);
  }
  return true;
}

export function validateLifecycleOperation(operation, label = "lifecycle operation") {
  assert(operation && typeof operation === "object", `Invalid ${label}.`);
  assert(LIFECYCLE_DISPOSITIONS.includes(operation.disposition), `Unknown lifecycle disposition: ${operation.disposition}`);
  assert(Array.isArray(operation.steps), `${label} steps must be an array.`);
  operation.steps.forEach((step, index) => validateLifecycleStep(step, `${label} step ${index + 1}`));
  const actionable = ["supported", "manual"].includes(operation.disposition);
  if (actionable) {
    assert(operation.steps.length > 0, `${label} ${operation.disposition} disposition must require steps.`);
    validateContractEvidence(operation.contractEvidence, label);
  } else {
    assert(operation.steps.length === 0, `${label} ${operation.disposition} disposition cannot declare steps.`);
    if (operation.contractEvidence != null) validateContractEvidence(operation.contractEvidence, label);
  }
  return true;
}

export function validateHostSurface(surface, hostId = "<unbound>") {
  assert(surface && typeof surface === "object", `Invalid host surface for ${hostId}.`);
  assertIdentifier(surface.surfaceId, "surface id");
  const label = `${hostId}/${surface.surfaceId}`;
  assertNonEmptyString(surface.displayName, `Surface has no display name: ${label}`);
  assert(HOST_DISTRIBUTION_KINDS.includes(surface.distributionKind), `Invalid distribution for ${label}`);
  assertStringArray(surface.scopes, `Surface has no valid scopes: ${label}`, { nonEmpty: true });
  assert(new Set(surface.scopes).size === surface.scopes.length, `Surface repeats scopes: ${label}`);
  assert(surface.scopes.every((scope) => HOST_SCOPES.includes(scope)), `Invalid scope for ${label}`);
  assert(surface.scopes.includes(surface.defaultScope), `Invalid default scope for ${label}`);
  assertNonEmptyString(surface.docsPath, `Surface has no documentation path: ${label}`);
  assert(HOST_OBSERVATION_KINDS.includes(surface.observation?.kind), `Invalid observation kind for ${label}`);
  assert(
    HOST_DISCOVERY_SOURCES.includes(surface.observation?.discoverySource),
    `Invalid observation discovery source for ${label}`,
  );
  assert(
    HOST_SCOPE_ARTIFACT_POLICIES.includes(surface.scopeArtifactPolicy),
    `Invalid scope artifact policy for ${label}`,
  );
  if (surface.scopeArtifactPolicy === "shared") {
    validateContractEvidence(surface.scopeArtifactEvidence, `${label}/scope-artifact-policy`);
  } else {
    assert(surface.scopeArtifactEvidence == null, `Independent scope artifact policy cannot declare evidence for ${label}`);
  }
  if (surface.observation.discoveryDiagnostic != null) {
    assertNonEmptyString(surface.observation.discoveryDiagnostic, `Invalid discovery diagnostic for ${label}`);
  }
  if (surface.observation.discoverySource === "diagnostic") {
    assertNonEmptyString(surface.observation.discoveryDiagnostic, `Diagnostic discovery source requires a diagnostic for ${label}`);
  } else {
    assert(
      surface.observation.discoveryDiagnostic == null,
      `Only diagnostic discovery can declare a discovery diagnostic for ${label}`,
    );
  }
  if (surface.observation.evidenceRouteOption != null) {
    assert(
      typeof surface.observation.evidenceRouteOption === "string"
        && /^[a-z][A-Za-z0-9]*$/u.test(surface.observation.evidenceRouteOption),
      `Invalid observation evidence route for ${label}`,
    );
  }
  if (surface.distributionKind === "bundled") {
    assert(surface.observation.kind === "bundled", `Bundled surface must use bundled observation for ${label}`);
  }
  if (surface.distributionKind === "source-local") {
    assert(surface.observation.kind === "session-only", `Source-local surface must use session-only observation for ${label}`);
  }
  if (surface.scopeValues != null) {
    assert(surface.scopeValues && typeof surface.scopeValues === "object" && !Array.isArray(surface.scopeValues), `Invalid scope values for ${label}`);
    for (const [scope, value] of Object.entries(surface.scopeValues)) {
      assert(surface.scopes.includes(scope), `Scope value is not declared by ${label}: ${scope}`);
      assertNonEmptyString(value, `Invalid scope value for ${label}: ${scope}`);
    }
  }
  if (surface.nativeHomeBinding != null) {
    const binding = surface.nativeHomeBinding;
    assert(binding && typeof binding === "object" && !Array.isArray(binding), `Invalid native home binding for ${label}`);
    assert(NATIVE_HOME_BINDING_KINDS.includes(binding.kind), `Invalid native home binding kind for ${label}`);
    assert(
      typeof binding.variable === "string" && /^[A-Z_][A-Z0-9_]*$/u.test(binding.variable),
      `Invalid native home environment variable for ${label}`,
    );
    validateContractEvidence(binding.contractEvidence, `${label}/native-home-binding`);
  }
  assert(surface.lifecycle && typeof surface.lifecycle === "object", `Surface has no lifecycle: ${label}`);
  assert(
    JSON.stringify(Object.keys(surface.lifecycle).sort()) === JSON.stringify([...LIFECYCLE_OPERATION_NAMES].sort()),
    `Surface lifecycle operations must be exact for ${label}`,
  );
  for (const operationName of LIFECYCLE_OPERATION_NAMES) {
    validateLifecycleOperation(surface.lifecycle[operationName], `${label}/${operationName}`);
  }
  return true;
}

function validateIdentity(identity, hostId) {
  assert(identity && typeof identity === "object", `Host has no Better Harness identity: ${hostId}`);
  for (const key of ["names", "nativeIds", "repositories"]) {
    assertStringArray(identity[key], `Host has invalid identity ${key}: ${hostId}`, { nonEmpty: true });
  }
}

export function validateHostProfile(profile) {
  assert(profile && typeof profile === "object", "Host profile must be an object.");
  assert(profile.schemaVersion === HOST_SUPPORT_SCHEMA_VERSION, `Unsupported host profile schema: ${profile.hostId}`);
  assertIdentifier(profile.hostId, "host id");
  assertNonEmptyString(profile.displayName, `Host has no display name: ${profile.hostId}`);
  assert(typeof profile.managed === "boolean", `Host has invalid managed state: ${profile.hostId}`);
  assertStringArray(profile.aliases, `Host has invalid aliases: ${profile.hostId}`);
  assert(new Set(profile.aliases).size === profile.aliases.length, `Host repeats aliases: ${profile.hostId}`);
  for (const alias of profile.aliases) {
    assertIdentifier(alias, "host alias");
    assert(alias !== profile.hostId, `Host alias conflicts with host id: ${alias}`);
  }
  assertNonEmptyString(profile.provider, `Host has no inventory provider: ${profile.hostId}`);
  assert(
    typeof profile.inventoryHomeOption === "string"
      && /^[a-z][A-Za-z0-9]*$/u.test(profile.inventoryHomeOption),
    `Invalid inventory home option: ${profile.hostId}`,
  );
  validateInventoryHomeRoutes(profile);
  assertStringArray(profile.executables, `Host has invalid executables: ${profile.hostId}`);
  if (profile.managed) assert(profile.executables.length > 0, `Managed host has no executable: ${profile.hostId}`);
  validateIdentity(profile.identity, profile.hostId);
  assert(Array.isArray(profile.surfaces) && profile.surfaces.length > 0, `Host has no surfaces: ${profile.hostId}`);
  const surfaceIds = new Set();
  for (const surface of profile.surfaces) {
    assert(!surfaceIds.has(surface.surfaceId), `Duplicate surface ${profile.hostId}/${surface.surfaceId}`);
    surfaceIds.add(surface.surfaceId);
    validateHostSurface(surface, profile.hostId);
    if (surface.observation.evidenceRouteOption != null) {
      assert(
        profile.inventoryHomeRoutes.some((route) => route.option === surface.observation.evidenceRouteOption),
        `Unknown observation evidence route for ${profile.hostId}/${surface.surfaceId}: ${surface.observation.evidenceRouteOption}`,
      );
    }
  }
  return true;
}

export function validateHostProfileRegistry(profiles) {
  assert(Array.isArray(profiles) && profiles.length > 0, "Host profile registry must be a non-empty array.");
  const ids = new Set();
  const aliases = new Set();
  for (const profile of profiles) {
    validateHostProfile(profile);
    assert(!ids.has(profile.hostId), `Duplicate host id: ${profile.hostId}`);
    ids.add(profile.hostId);
    for (const alias of profile.aliases) {
      assert(!aliases.has(alias), `Duplicate host alias: ${alias}`);
      aliases.add(alias);
    }
  }
  for (const alias of aliases) assert(!ids.has(alias), `Host alias conflicts with host id: ${alias}`);
  return true;
}
