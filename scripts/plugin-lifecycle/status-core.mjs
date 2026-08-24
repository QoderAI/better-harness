import path from "node:path";

import { collectAgentCustomizeInventory } from "../agent-customize/index.mjs";
import {
  matchesBetterHarnessPlugin,
  stableSerialize,
} from "./identity.mjs";
import { PLUGIN_ID, PLUGIN_LIFECYCLE_SCHEMA_VERSION } from "./model.mjs";
import {
  observedHostDiscovery,
  observedScopes,
  requiresInventoryCollection,
  singleInventoryCandidate,
  usesSingleInventoryCandidate,
} from "./observation.mjs";
import {
  discoverHostExecutable,
  normalizeLifecyclePaths,
  packageInfo,
} from "./runtime.mjs";
import {
  buildInventoryFailureStatusRow,
  buildObservedStatusRow,
  buildUnresolvedScopeStatusRow,
} from "./status-row.mjs";
import { resolveStatusTarget } from "./target-resolution.mjs";

function providerOptions(profile, options) {
  const result = {
    provider: profile.provider,
    workspace: options.workspace,
    includeUserHome: options.includeUserHome !== false,
  };
  if (options.hostHome) {
    for (const route of profile.inventoryHomeRoutes) {
      result[route.option] = route.relativePath
        ? path.join(options.hostHome, route.relativePath)
        : options.hostHome;
    }
  }
  return result;
}

async function collectHostStatus(profile, expectedVersion, options, selectedSurface) {
  const collectInventory = options.inventoryCollector ?? collectAgentCustomizeInventory;
  const hostDiscovery = await discoverHostExecutable(profile, options);
  const surfaces = selectedSurface ? [selectedSurface] : profile.surfaces;
  const inventoryRequired = surfaces.some(requiresInventoryCollection);
  let inventory = { plugins: [], diagnostics: {} };
  if (inventoryRequired) {
    try {
      inventory = await collectInventory(providerOptions(profile, options));
    } catch {
      return {
        rows: surfaces.map((surface) => {
          const surfaceHostDiscovery = observedHostDiscovery(surface, { diagnostics: {} }, hostDiscovery);
          return requiresInventoryCollection(surface)
            ? buildInventoryFailureStatusRow({
                profile,
                surface,
                hostDiscovery: surfaceHostDiscovery,
                expectedVersion,
                options,
              })
            : buildObservedStatusRow({
                profile,
                surface,
                scope: surface.defaultScope,
                hostDiscovery: surfaceHostDiscovery,
                expectedVersion,
                options,
              });
        }),
        inventoryRequired,
        inventoryFailed: true,
      };
    }
  }

  const matching = (inventory.plugins ?? []).filter((plugin) => (
    plugin?.applicable !== false && matchesBetterHarnessPlugin(plugin, profile)
  ));
  const rows = [];
  for (const surface of surfaces) {
    const surfaceHostDiscovery = observedHostDiscovery(surface, inventory, hostDiscovery);
    if (usesSingleInventoryCandidate(surface)) {
      rows.push(buildObservedStatusRow({
        profile,
        surface,
        plugin: singleInventoryCandidate(surface, matching),
        scope: surface.defaultScope,
        hostDiscovery: surfaceHostDiscovery,
        expectedVersion,
        options,
      }));
      continue;
    }
    if (matching.length === 0) {
      rows.push(buildObservedStatusRow({
        profile,
        surface,
        scope: surface.defaultScope,
        hostDiscovery: surfaceHostDiscovery,
        expectedVersion,
        options,
      }));
      continue;
    }
    for (const plugin of matching) {
      const scopes = observedScopes(plugin, surface);
      if (scopes.length === 0) {
        rows.push(buildUnresolvedScopeStatusRow({
          profile,
          surface,
          plugin,
          hostDiscovery: surfaceHostDiscovery,
          expectedVersion,
          options,
        }));
        continue;
      }
      for (const scope of scopes) {
        rows.push(buildObservedStatusRow({
          profile,
          surface,
          plugin,
          scope,
          hostDiscovery: surfaceHostDiscovery,
          expectedVersion,
          options,
        }));
      }
    }
  }
  return { rows, inventoryRequired, inventoryFailed: false };
}

function commandStatus(rows, { inventoryRequirements = 0, inventoryFailures = 0 } = {}) {
  if (rows.length === 0 || (inventoryRequirements > 0 && inventoryFailures === inventoryRequirements)) return "failed";
  if (inventoryFailures > 0) return "partial";
  if (rows.some((row) => row.verification !== "passed" || row.diagnostics.some((item) => item.severity !== "info"))) {
    return "partial";
  }
  return "ok";
}

export async function inspectPluginLifecycle(options = {}) {
  const normalizedOptions = normalizeLifecyclePaths(options);
  const info = await packageInfo(normalizedOptions);
  const { profiles, surface: selectedSurface } = resolveStatusTarget(normalizedOptions);
  const collected = await Promise.all(
    profiles.map((profile) => collectHostStatus(profile, info.version, normalizedOptions, selectedSurface)),
  );
  let rows = collected.flatMap((entry) => entry.rows);
  const hostOrder = new Map(profiles.map((profile, index) => [profile.hostId, index]));
  const surfaceOrder = new Map(profiles.flatMap((profile) => (
    profile.surfaces.map((surface, index) => [`${profile.hostId}/${surface.surfaceId}`, index])
  )));
  const scopeOrder = new Map(profiles.flatMap((profile) => (
    profile.surfaces.flatMap((surface) => surface.scopes.map((scope, index) => (
      [`${profile.hostId}/${surface.surfaceId}/${scope}`, index]
    )))
  )));
  rows.sort((left, right) => {
    const hostDifference = hostOrder.get(left.target.hostId) - hostOrder.get(right.target.hostId);
    if (hostDifference !== 0) return hostDifference;
    const leftSurface = `${left.target.hostId}/${left.target.surfaceId}`;
    const rightSurface = `${right.target.hostId}/${right.target.surfaceId}`;
    const surfaceDifference = surfaceOrder.get(leftSurface) - surfaceOrder.get(rightSurface);
    if (surfaceDifference !== 0) return surfaceDifference;
    const scopeDifference = scopeOrder.get(`${leftSurface}/${left.target.scope}`)
      - scopeOrder.get(`${rightSurface}/${right.target.scope}`);
    if (scopeDifference !== 0) return scopeDifference;
    const serializedLeft = stableSerialize(left);
    const serializedRight = stableSerialize(right);
    return serializedLeft < serializedRight ? -1 : (serializedLeft > serializedRight ? 1 : 0);
  });
  const inventoryRequirements = collected.filter((entry) => entry.inventoryRequired).length;
  const inventoryFailures = collected.filter((entry) => entry.inventoryFailed).length;
  return {
    kind: "better-harness-plugin-status",
    schemaVersion: PLUGIN_LIFECYCLE_SCHEMA_VERSION,
    status: commandStatus(rows, { inventoryRequirements, inventoryFailures }),
    plugin: { id: PLUGIN_ID, packageVersion: info.version },
    rows,
    diagnostics: rows.flatMap((row) => row.diagnostics),
  };
}

export async function verifyPluginLifecycle(options = {}) {
  const result = await inspectPluginLifecycle(options);
  const failed = result.rows.filter((row) => row.verification === "failed");
  const partial = result.rows.filter((row) => ["partial", "unobserved"].includes(row.verification));
  return {
    kind: "better-harness-plugin-verification",
    schemaVersion: PLUGIN_LIFECYCLE_SCHEMA_VERSION,
    status: result.status === "failed" || failed.length === result.rows.length
      ? "failed"
      : (failed.length > 0 || partial.length > 0 ? "partial" : "ok"),
    plugin: result.plugin,
    summary: {
      targets: result.rows.length,
      passed: result.rows.filter((row) => row.verification === "passed").length,
      partial: partial.length,
      failed: failed.length,
    },
    rows: result.rows,
    diagnostics: result.diagnostics,
  };
}
