export const PLUGIN_VALUE_OPTIONS = Object.freeze({
  "--host": "host",
  "--surface": "surface",
  "--scope": "scope",
});

const OPTION_KEYS = new Set(Object.values(PLUGIN_VALUE_OPTIONS));

function defineManifestEntry(entry) {
  if (!/^[a-z][a-z0-9-]*$/u.test(entry.name)) {
    throw new TypeError(`Invalid plugin command name: ${entry.name}`);
  }
  if (!/^plugin-lifecycle\/[a-z][a-z0-9-]*\.mjs$/u.test(entry.entryScript)) {
    throw new TypeError(`Invalid plugin command entry script: ${entry.name}`);
  }
  if (entry.audience !== "advanced" || typeof entry.summary !== "string" || entry.summary.length === 0) {
    throw new TypeError(`Plugin command requires root registry metadata: ${entry.name}`);
  }
  if (typeof entry.usageLine !== "string" || !entry.usageLine.startsWith(`better-harness plugin ${entry.name}`)) {
    throw new TypeError(`Plugin command has an invalid usage synopsis: ${entry.name}`);
  }
  if (!Array.isArray(entry.allowedOptions) || entry.allowedOptions.some((key) => !OPTION_KEYS.has(key))) {
    throw new TypeError(`Plugin command has invalid option ownership: ${entry.name}`);
  }
  if (new Set(entry.allowedOptions).size !== entry.allowedOptions.length) {
    throw new TypeError(`Plugin command repeats an option owner: ${entry.name}`);
  }
  if (!["none", "enum"].includes(entry.positionals?.kind)) {
    throw new TypeError(`Plugin command has an invalid positional contract: ${entry.name}`);
  }
  if (entry.positionals.kind === "enum" && (
    !entry.positionals.key
    || !Array.isArray(entry.positionals.values)
    || entry.positionals.values.length === 0
    || !entry.positionals.error?.code
    || !entry.positionals.error?.message
  )) {
    throw new TypeError(`Plugin command has an incomplete enum contract: ${entry.name}`);
  }
  return Object.freeze({
    ...entry,
    allowedOptions: Object.freeze([...entry.allowedOptions]),
    positionals: Object.freeze({
      ...entry.positionals,
      ...(entry.positionals.values
        ? { values: Object.freeze([...entry.positionals.values]) }
        : {}),
      ...(entry.positionals.error
        ? { error: Object.freeze({ ...entry.positionals.error }) }
        : {}),
    }),
  });
}

function defineManifest(entries) {
  const names = entries.map((entry) => entry.name);
  if (new Set(names).size !== names.length) {
    throw new TypeError("Plugin command manifest requires unique names.");
  }
  return Object.freeze(entries.map(defineManifestEntry));
}

export const PLUGIN_COMMAND_MANIFEST = defineManifest([
  {
    name: "status",
    entryScript: "plugin-lifecycle/status.mjs",
    audience: "advanced",
    summary: "Inspect Better Harness installation and verification state across hosts.",
    usageLine: "better-harness plugin status [--host <host|all>] [options]",
    allowedOptions: ["host", "surface"],
    positionals: { kind: "none" },
  },
  {
    name: "plan",
    entryScript: "plugin-lifecycle/plan.mjs",
    audience: "advanced",
    summary: "Build a deterministic install, update, or remove plan without executing it.",
    usageLine: "better-harness plugin plan <install|update|remove> --host <host> [options]",
    allowedOptions: ["host", "surface", "scope"],
    positionals: {
      kind: "enum",
      key: "action",
      values: ["install", "update", "remove"],
      error: {
        code: "INVALID_PLAN_ACTION",
        message: "Plugin plan requires exactly one action: install, update, or remove.",
      },
    },
  },
  {
    name: "verify",
    entryScript: "plugin-lifecycle/verify.mjs",
    audience: "advanced",
    summary: "Verify local Better Harness install, manifest, Skill, and enablement evidence.",
    usageLine: "better-harness plugin verify [--host <host|all>] [options]",
    allowedOptions: ["host", "surface"],
    positionals: { kind: "none" },
  },
]);

export function pluginCommandNames() {
  return PLUGIN_COMMAND_MANIFEST.map((entry) => entry.name);
}
