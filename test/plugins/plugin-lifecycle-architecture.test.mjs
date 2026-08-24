import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";

import * as lifecycle from "../../scripts/plugin-lifecycle/index.mjs";

const root = process.cwd();
const scriptsRoot = path.join(root, "scripts");
const lifecycleRoot = path.join(scriptsRoot, "plugin-lifecycle");

function moduleFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return moduleFiles(filePath);
    return entry.isFile() && entry.name.endsWith(".mjs") ? [filePath] : [];
  });
}

test("plugin lifecycle exposes one stable public module surface", () => {
  assert.deepEqual(Object.keys(lifecycle).sort(), [
    "LifecycleCliError",
    "PLUGIN_ID",
    "PLUGIN_LIFECYCLE_SCHEMA_VERSION",
    "authorizedRootLabel",
    "buildPluginLifecyclePlan",
    "cliErrorEnvelope",
    "commandEnvelope",
    "diagnostic",
    "discoverHostExecutable",
    "exitCodeFor",
    "inspectPluginLifecycle",
    "matchesBetterHarnessPlugin",
    "normalizeReadOnlyTimeout",
    "parseReadOnlyOptions",
    "pluginLifecycleRuntimeInfo",
    "runReadOnlyCommand",
    "stableDigest",
    "validateWorkspace",
    "verifyPluginLifecycle",
    "withTimeout",
  ]);
});

test("plugin lifecycle keeps its declared responsibility modules", () => {
  const modules = new Set(readdirSync(lifecycleRoot));
  for (const name of [
    "identity.mjs",
    "command-definitions.mjs",
    "command-manifest.mjs",
    "human-output.mjs",
    "model.mjs",
    "observation.mjs",
    "plan-core.mjs",
    "plan-model.mjs",
    "runtime.mjs",
    "status-core.mjs",
    "status-row.mjs",
    "target-resolution.mjs",
  ]) assert.equal(modules.has(name), true, name);
});

test("cross-capability lifecycle imports use the public surface", () => {
  const importPattern = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/gu;
  const violations = [];
  for (const filePath of moduleFiles(scriptsRoot)) {
    if (filePath.startsWith(`${lifecycleRoot}${path.sep}`)) continue;
    const source = readFileSync(filePath, "utf8");
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      const metadataProjection = relativePath === "scripts/better-harness-cli/registry.mjs"
        && specifier.endsWith("plugin-lifecycle/command-manifest.mjs");
      if (
        specifier.includes("plugin-lifecycle/")
        && !specifier.endsWith("plugin-lifecycle/index.mjs")
        && !metadataProjection
      ) violations.push(`${relativePath} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});
