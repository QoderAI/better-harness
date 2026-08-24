function observationKind(surface) {
  return surface.observation.kind;
}

export function observedScopes(plugin, surface) {
  if (observationKind(surface) !== "inventory") return [surface.defaultScope];
  const values = Array.isArray(plugin?.installSources)
    ? plugin.installSources
    : [plugin?.installSource];
  const normalized = values
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0 || normalized.some((value) => !surface.scopes.includes(value))) {
    return [];
  }
  return [...new Set(normalized)];
}

export function observedInstallation(surface, plugin) {
  switch (observationKind(surface)) {
    case "bundled": return "bundled";
    case "session-only": return "session-only";
    case "desktop-cache": return "unknown";
    default: return plugin ? "installed" : "not-installed";
  }
}

export function observedEnablement(surface, plugin) {
  switch (observationKind(surface)) {
    case "bundled":
    case "session-only":
      return "not-applicable";
    case "desktop-cache":
      return "unknown";
    default:
      if (!plugin || plugin.enabled == null) return "unknown";
      return plugin.enabled ? "enabled" : "disabled";
  }
}

export function observedHostDiscovery(surface, inventory, executableDiscovery) {
  switch (surface.observation.discoverySource) {
    case "unobserved": return "unobserved";
    case "diagnostic": {
      const observed = inventory.diagnostics?.[surface.observation.discoveryDiagnostic];
      return observed === true ? "present" : (observed === false ? "absent" : "unobserved");
    }
    default: return executableDiscovery;
  }
}

export function inventoryFailureInstallation(surface) {
  return observationKind(surface) === "bundled" ? "bundled" : "unknown";
}

export function usesSingleInventoryCandidate(surface) {
  return observationKind(surface) !== "inventory";
}

export function requiresInventoryCollection(surface) {
  return !["bundled", "session-only"].includes(observationKind(surface));
}

export function singleInventoryCandidate() {
  return undefined;
}

export function hasUnobservedDesktopEnablement(surface) {
  return observationKind(surface) === "desktop-cache";
}
