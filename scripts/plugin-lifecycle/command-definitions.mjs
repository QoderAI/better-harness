import { LifecycleCliError } from "./contract.mjs";
import {
  PLUGIN_COMMAND_MANIFEST,
  PLUGIN_VALUE_OPTIONS,
  pluginCommandNames,
} from "./command-manifest.mjs";
import { renderPlan, renderStatus } from "./human-output.mjs";
import { buildPluginLifecyclePlan } from "./plan-core.mjs";
import { PLUGIN_LIFECYCLE_ACTIONS } from "./plan-model.mjs";
import { inspectPluginLifecycle, verifyPluginLifecycle } from "./status-core.mjs";

const COMMAND_RUNTIME = Object.freeze({
  status: Object.freeze({
    execute: inspectPluginLifecycle,
    renderHuman: renderStatus,
  }),
  plan: Object.freeze({
    execute: buildPluginLifecyclePlan,
    renderHuman: renderPlan,
  }),
  verify: Object.freeze({
    execute: verifyPluginLifecycle,
    renderHuman: renderStatus,
  }),
});

const runtimeNames = Object.keys(COMMAND_RUNTIME).sort();
const manifestNames = pluginCommandNames().sort();
if (JSON.stringify(runtimeNames) !== JSON.stringify(manifestNames)) {
  throw new TypeError("Plugin command manifest and runtime bindings must have exact parity.");
}
const planActions = PLUGIN_COMMAND_MANIFEST.find((entry) => entry.name === "plan")?.positionals.values;
if (JSON.stringify(planActions) !== JSON.stringify(PLUGIN_LIFECYCLE_ACTIONS)) {
  throw new TypeError("Plugin plan manifest and lifecycle action model must have exact parity.");
}

export const PLUGIN_COMMAND_DEFINITIONS = Object.freeze(
  PLUGIN_COMMAND_MANIFEST.map((entry) => Object.freeze({
    ...entry,
    ...COMMAND_RUNTIME[entry.name],
  })),
);

export { PLUGIN_VALUE_OPTIONS, pluginCommandNames } from "./command-manifest.mjs";

export function requirePluginCommandDefinition(command) {
  const definition = PLUGIN_COMMAND_DEFINITIONS.find((entry) => entry.name === command);
  if (!definition) {
    throw new LifecycleCliError(
      "UNKNOWN_PLUGIN_COMMAND",
      `Unknown plugin command: ${command}`,
      { kind: "usage" },
    );
  }
  return definition;
}
