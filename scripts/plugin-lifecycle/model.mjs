export const PLUGIN_LIFECYCLE_SCHEMA_VERSION = "1";
export const PLUGIN_ID = "better-harness";

const DIAGNOSTIC_SEVERITIES = Object.freeze(["info", "warning", "error"]);

export function assertLifecycle(condition, message) {
  if (!condition) throw new TypeError(message);
}

export function assertLifecycleString(value, message) {
  assertLifecycle(typeof value === "string" && value.length > 0, message);
}

export function assertLifecycleControlled(values, value, label, family) {
  assertLifecycle(values.includes(value), `Invalid ${label} ${family}: ${value}`);
}

export function validateLifecyclePlugin(plugin, {
  label,
  versionField,
  versionLabel,
}) {
  assertLifecycle(plugin && typeof plugin === "object", `${label} plugin must be an object.`);
  assertLifecycle(plugin.id === PLUGIN_ID, `Invalid ${label} plugin identity.`);
  assertLifecycleString(plugin[versionField], `Missing ${label} ${versionLabel}.`);
  return true;
}

export function validateLifecycleTarget(target, {
  label,
  expectedSource = false,
} = {}) {
  assertLifecycle(target && typeof target === "object", `${label} target must be an object.`);
  assertLifecycleString(target.hostId, `Missing ${label} host id.`);
  assertLifecycleString(target.surfaceId, `Missing ${label} surface id.`);
  assertLifecycleString(target.scope, `Missing ${label} scope.`);
  assertLifecycleString(target.distributionKind, `Missing ${label} distribution kind.`);
  if (expectedSource) {
    assertLifecycleString(target.expectedSource?.pluginId, `Missing ${label} native plugin id.`);
    assertLifecycleString(target.expectedSource.repository, `Missing ${label} repository identity.`);
  }
  return true;
}

export function validateLifecycleDiagnostics(items, label) {
  assertLifecycle(Array.isArray(items), `${label} diagnostics must be an array.`);
  for (const item of items) {
    assertLifecycle(item && typeof item === "object", `${label} diagnostic must be an object.`);
    assertLifecycleString(item.code, `${label} diagnostic code is missing.`);
    assertLifecycleControlled(
      DIAGNOSTIC_SEVERITIES,
      item.severity,
      label,
      "diagnostic severity",
    );
    assertLifecycleString(item.message, `${label} diagnostic message is missing.`);
  }
  return true;
}
