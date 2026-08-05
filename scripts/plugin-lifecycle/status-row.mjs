import path from "node:path";

import { diagnostic } from "./contract.mjs";
import { normalizeIdentity } from "./identity.mjs";
import {
  assertLifecycle,
  assertLifecycleControlled,
  assertLifecycleString,
  PLUGIN_ID,
  PLUGIN_LIFECYCLE_SCHEMA_VERSION,
  validateLifecycleDiagnostics,
  validateLifecyclePlugin,
  validateLifecycleTarget,
} from "./model.mjs";
import {
  hasUnobservedDesktopEnablement,
  inventoryFailureInstallation,
  observedEnablement,
  observedInstallation,
} from "./observation.mjs";
import { authorizedRootLabel, redactPath } from "./runtime.mjs";

const CONTROLLED_STATES = Object.freeze({
  hostDiscovery: Object.freeze(["present", "absent", "unobserved"]),
  installation: Object.freeze(["installed", "not-installed", "bundled", "session-only", "unknown"]),
  enablement: Object.freeze(["enabled", "disabled", "unknown", "not-applicable"]),
  versionRelation: Object.freeze(["same", "different", "unobserved"]),
  verification: Object.freeze(["passed", "partial", "failed", "unobserved"]),
  checkStatus: Object.freeze(["passed", "failed", "unobserved"]),
});

function assertControlled(family, value) {
  assertLifecycleControlled(CONTROLLED_STATES[family], value, "PluginLifecycleStatusV1", family);
}

export function validatePluginLifecycleStatusRow(row) {
  assertLifecycle(row && typeof row === "object", "PluginLifecycleStatusV1 row must be an object.");
  assertLifecycle(row.schemaVersion === PLUGIN_LIFECYCLE_SCHEMA_VERSION, "Invalid PluginLifecycleStatusV1 schema version.");
  validateLifecyclePlugin(row.plugin, {
    label: "PluginLifecycleStatusV1",
    versionField: "expectedVersion",
    versionLabel: "expected version",
  });
  validateLifecycleTarget(row.target, { label: "PluginLifecycleStatusV1" });
  assertControlled("hostDiscovery", row.hostDiscovery);
  assertControlled("installation", row.installation);
  assertControlled("enablement", row.enablement);
  assertControlled("versionRelation", row.version?.relation);
  if (row.version.relation === "unobserved") {
    assertLifecycle(row.version.observed == null, "Unobserved PluginLifecycleStatusV1 version cannot include an observed value.");
  } else {
    assertLifecycleString(row.version.observed, "Observed PluginLifecycleStatusV1 version is missing.");
  }
  assertControlled("verification", row.verification);
  assertLifecycle(row.activation === "unobserved", "PluginLifecycleStatusV1 activation must remain unobserved without runtime evidence.");
  assertLifecycle(Array.isArray(row.checks), "PluginLifecycleStatusV1 checks must be an array.");
  for (const check of row.checks) {
    assertLifecycleString(check.id, "PluginLifecycleStatusV1 check id is missing.");
    assertControlled("checkStatus", check.status);
  }
  assertLifecycle(Array.isArray(row.evidence) && row.evidence.length > 0, "PluginLifecycleStatusV1 evidence must be non-empty.");
  for (const evidence of row.evidence) {
    assertLifecycle(evidence.class === "local-config", "PluginLifecycleStatusV1 evidence must remain local-config.");
    assertLifecycleString(evidence.path, "PluginLifecycleStatusV1 evidence path is missing.");
  }
  validateLifecycleDiagnostics(row.diagnostics, "PluginLifecycleStatusV1");
  return true;
}

function versionState(observed, expected) {
  if (!observed) return { relation: "unobserved" };
  return {
    observed: String(observed),
    relation: String(observed) === String(expected) ? "same" : "different",
  };
}

function fallbackEvidencePath(profile, surface, options = {}) {
  const routeOption = surface.observation.evidenceRouteOption ?? profile.inventoryHomeOption;
  const route = profile.inventoryHomeRoutes.find((candidate) => candidate.option === routeOption);
  if (options.hostHome) {
    const resolvedRoot = route.relativePath
      ? path.join(options.hostHome, route.relativePath)
      : options.hostHome;
    return authorizedRootLabel(profile.hostId, { ...options, resolvedRoot });
  }
  return route.fallbackLabel;
}

function evidenceFor(plugin, profile, surface, options = {}) {
  const evidencePath = plugin?.evidence?.path ?? plugin?.installRecordPath;
  const pathLabel = redactPath(evidencePath, options);
  return pathLabel
    ? [{ class: "local-config", path: pathLabel }]
    : [{ class: "local-config", path: fallbackEvidencePath(profile, surface, options) }];
}

function skillIsPresent(plugin) {
  if (!Array.isArray(plugin?.skills)) return undefined;
  return plugin.skills.some((skill) => normalizeIdentity(skill.name) === PLUGIN_ID);
}

function boundedVerification(verification, code, severity, message, checks = []) {
  return {
    verification,
    activation: "unobserved",
    checks,
    diagnostics: [diagnostic(code, severity, message)],
  };
}

function verificationFor({ installation, enabled, plugin, profile, surface }) {
  if (!profile.managed) {
    return boundedVerification(
      "unobserved",
      "PLUGIN_LIFECYCLE_UNSUPPORTED",
      "warning",
      `${profile.displayName} has no managed Better Harness plugin lifecycle surface.`,
    );
  }
  if (installation === "not-installed") {
    return boundedVerification("failed", "PLUGIN_NOT_INSTALLED", "warning", "Better Harness was not found in local install evidence.");
  }
  if (installation === "unknown") {
    return boundedVerification("unobserved", "INSTALLATION_STATE_UNOBSERVED", "warning", "The available local evidence cannot prove installation for this surface.");
  }
  if (installation === "session-only") {
    return boundedVerification(
      "unobserved",
      "SESSION_ACTIVATION_UNOBSERVED",
      "warning",
      `${surface.displayName} activation is observable only inside the session that loaded it.`,
    );
  }
  if (installation === "bundled" && !plugin) {
    return boundedVerification("partial", "BUNDLED_RUNTIME_UNOBSERVED", "warning", "Better Harness is declared as bundled, but runtime activation was not probed.");
  }
  const diagnostics = [];
  const checks = [];
  checks.push({ id: "plugin-identity", status: "passed" });
  const skillPresent = skillIsPresent(plugin);
  if (skillPresent === false) {
    checks.push({ id: "skill-route", status: "failed" });
    return boundedVerification(
      "failed",
      "BETTER_HARNESS_SKILL_MISSING",
      "error",
      "The installed plugin evidence does not expose the better-harness Skill.",
      checks,
    );
  }
  checks.push({ id: "skill-route", status: skillPresent === true ? "passed" : "unobserved" });
  if (enabled === false) {
    diagnostics.push(diagnostic("PLUGIN_DISABLED", "warning", "Better Harness is installed but disabled at the observed scope."));
  }
  diagnostics.push(diagnostic("RUNTIME_ACTIVATION_UNOBSERVED", "info", "Local install evidence does not prove that an existing session loaded the Skill."));
  return {
    verification: "partial",
    activation: "unobserved",
    checks,
    diagnostics,
  };
}

function createStatusRow({
  profile,
  surface,
  scope,
  hostDiscovery,
  expectedVersion,
  installation,
  enablement,
  version,
  verification,
  activation,
  checks,
  evidence,
  diagnostics,
}) {
  assertLifecycle(
    surface.scopes.includes(scope),
    `PluginLifecycleStatusV1 scope ${scope} is not declared by ${profile.hostId}/${surface.surfaceId}.`,
  );
  const row = {
    schemaVersion: PLUGIN_LIFECYCLE_SCHEMA_VERSION,
    plugin: { id: PLUGIN_ID, expectedVersion },
    target: {
      hostId: profile.hostId,
      surfaceId: surface.surfaceId,
      scope,
      distributionKind: surface.distributionKind,
    },
    hostDiscovery,
    installation,
    enablement,
    version,
    verification,
    activation,
    checks,
    evidence,
    diagnostics,
  };
  validatePluginLifecycleStatusRow(row);
  return row;
}

export function buildObservedStatusRow({
  profile,
  surface,
  plugin,
  scope,
  hostDiscovery,
  expectedVersion,
  options,
}) {
  let installation = observedInstallation(surface, plugin);
  if (!profile.managed) installation = "unknown";
  const verification = verificationFor({
    installation,
    enabled: plugin?.enabled,
    plugin,
    profile,
    surface,
  });
  if (hasUnobservedDesktopEnablement(surface)) {
    verification.diagnostics.push(diagnostic(
      "DESKTOP_ENABLEMENT_UNOBSERVED",
      "warning",
      `${surface.displayName} cache evidence cannot prove that its desktop UI enabled the plugin.`,
    ));
  }
  return createStatusRow({
    profile,
    surface,
    scope,
    hostDiscovery,
    expectedVersion,
    installation,
    enablement: observedEnablement(surface, plugin),
    version: versionState(plugin?.version, expectedVersion),
    ...verification,
    evidence: evidenceFor(plugin, profile, surface, options),
  });
}

export function buildInventoryFailureStatusRow({ profile, surface, hostDiscovery, expectedVersion, options }) {
  return createStatusRow({
    profile,
    surface,
    scope: surface.defaultScope,
    hostDiscovery,
    expectedVersion,
    installation: inventoryFailureInstallation(surface),
    enablement: "unknown",
    version: { relation: "unobserved" },
    verification: "unobserved",
    activation: "unobserved",
    checks: [],
    evidence: [{ class: "local-config", path: fallbackEvidencePath(profile, surface, options ?? {}) }],
    diagnostics: [diagnostic(
      "INVENTORY_COLLECTION_FAILED",
      "error",
      `Configured-asset inventory failed for ${profile.displayName}.`,
    )],
  });
}

export function buildUnresolvedScopeStatusRow({
  profile,
  surface,
  plugin,
  hostDiscovery,
  expectedVersion,
  options,
}) {
  return createStatusRow({
    profile,
    surface,
    scope: surface.defaultScope,
    hostDiscovery,
    expectedVersion,
    installation: "unknown",
    enablement: "unknown",
    version: versionState(plugin?.version, expectedVersion),
    verification: "unobserved",
    activation: "unobserved",
    checks: [{ id: "plugin-identity", status: "passed" }],
    evidence: evidenceFor(plugin, profile, surface, options),
    diagnostics: [diagnostic(
      "INSTALL_SCOPE_UNSUPPORTED",
      "error",
      `Installed Better Harness evidence could not be assigned to a declared ${surface.displayName} scope.`,
    )],
  });
}
