import { collectAgentCustomizeInventory } from "../agent-customize/index.mjs";
import { getHostProfile } from "../host-support/index.mjs";
import {
  authorizedRootLabel,
  inspectPluginLifecycle,
  pluginLifecycleRuntimeInfo,
} from "../plugin-lifecycle/index.mjs";

function captureInventoryRoots(capturedRoots, providerOptions, inventory = {}) {
  const profile = getHostProfile(providerOptions.provider);
  if (!profile) return;
  const roots = capturedRoots.get(profile.hostId) ?? new Map();
  for (const route of profile.inventoryHomeRoutes) {
    const value = inventory?.[route.option] ?? providerOptions[route.option];
    if (typeof value === "string" && value.trim()) roots.set(route.option, value);
  }
  capturedRoots.set(profile.hostId, roots);
}

function effectiveAuthorizedRoots(hostId, capturedRoots, options) {
  const profile = getHostProfile(hostId);
  if (!profile) return [authorizedRootLabel(hostId)];
  const roots = capturedRoots.get(profile.hostId);
  const labels = profile.inventoryHomeRoutes.map((route) => {
    const resolvedRoot = roots?.get(route.option);
    if (resolvedRoot) {
      return authorizedRootLabel(hostId, {
        resolvedRoot,
        workspace: options.workspace,
        platform: options.runtimePlatform,
      });
    }
    return route.option === profile.inventoryHomeOption
      ? authorizedRootLabel(hostId)
      : route.fallbackLabel;
  });
  return [...new Set(labels.filter(Boolean))];
}

export async function runHarnessDoctor(options = {}) {
  const {
    inventoryCollector: requestedInventoryCollector,
    platform: host = "all",
    ...lifecycleOptions
  } = options;
  const capturedRoots = new Map();
  const collectInventory = requestedInventoryCollector ?? collectAgentCustomizeInventory;
  const inventoryCollector = async (providerOptions) => {
    captureInventoryRoots(capturedRoots, providerOptions);
    const inventory = await collectInventory(providerOptions);
    captureInventoryRoots(capturedRoots, providerOptions, inventory);
    return inventory;
  };
  const lifecycle = await inspectPluginLifecycle({
    ...lifecycleOptions,
    host,
    inventoryCollector,
  });
  const runtime = await pluginLifecycleRuntimeInfo(options);
  const hostIds = [...new Set(lifecycle.rows.map((row) => row.target.hostId))];
  const targets = hostIds.map((hostId) => {
    const rows = lifecycle.rows.filter((row) => row.target.hostId === hostId);
    return {
      hostId,
      hostDiscovery: rows.some((row) => row.hostDiscovery === "present")
        ? "present"
        : rows.some((row) => row.hostDiscovery === "absent") ? "absent" : "unobserved",
      authorizedRoots: effectiveAuthorizedRoots(hostId, capturedRoots, options),
      inventory: rows.some((row) => row.diagnostics.some((item) => item.code === "INVENTORY_COLLECTION_FAILED"))
        ? "failed"
        : "available",
      lifecycle: rows.map((row) => ({
        surfaceId: row.target.surfaceId,
        scope: row.target.scope,
        hostDiscovery: row.hostDiscovery,
        installation: row.installation,
        verification: row.verification,
      })),
    };
  });
  return {
    kind: "better-harness-doctor",
    schemaVersion: "1",
    status: lifecycle.status,
    runtime,
    privacy: {
      network: "none",
      writes: "none",
      transcripts: "not-read",
      pathPolicy: "user-home-redacted",
    },
    targets,
    diagnostics: lifecycle.diagnostics,
  };
}
