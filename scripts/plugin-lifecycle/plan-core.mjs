import {
  createPluginLifecyclePlan,
  requirePluginLifecycleAction,
} from "./plan-model.mjs";
import { inspectPluginLifecycle } from "./status-core.mjs";
import { resolvePlanTarget } from "./target-resolution.mjs";
import { normalizeLifecyclePaths } from "./runtime.mjs";

export async function buildPluginLifecyclePlan(options = {}) {
  const normalizedOptions = normalizeLifecyclePaths(options);
  const action = requirePluginLifecycleAction(normalizedOptions.action);
  const { profile, surface, scope } = resolvePlanTarget(normalizedOptions);
  const observed = await inspectPluginLifecycle({
    ...normalizedOptions,
    host: profile.hostId,
    surface: surface.surfaceId,
  });
  return createPluginLifecyclePlan({
    action,
    profile,
    surface,
    scope,
    workspace: normalizedOptions.workspace,
    hostHome: normalizedOptions.hostHome,
    observed,
  });
}
