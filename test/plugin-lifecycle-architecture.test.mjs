import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import * as lifecycle from "../scripts/plugin-lifecycle/index.mjs";

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

test("plugin lifecycle public index is an implementation-free stable surface", () => {
  const source = readFileSync(path.join(lifecycleRoot, "index.mjs"), "utf8");
  assert.doesNotMatch(source, /^import\s/mu);
  assert.doesNotMatch(source, /\b(?:function|class)\b/u);
  assert.doesNotMatch(source, /^(?:const|let|var)\s/mu);
  assert.ok(source.split("\n").length < 35, "public index should remain a compact export surface");
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

test("plugin lifecycle concerns have independent private owners", () => {
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
  ]) {
    assert.ok(modules.has(name), `missing lifecycle responsibility owner: ${name}`);
  }
});

test("status and plan share one target-resolution error owner", () => {
  const targetCodes = [
    "AMBIGUOUS_HOST_HOME",
    "AMBIGUOUS_HOST_SURFACE",
    "AMBIGUOUS_SURFACE",
    "EXPLICIT_HOST_REQUIRED",
    "UNKNOWN_HOST",
    "UNKNOWN_HOST_SURFACE",
    "UNSUPPORTED_SCOPE",
  ];
  const owners = new Map(targetCodes.map((code) => [code, []]));
  for (const filePath of moduleFiles(lifecycleRoot)) {
    const source = readFileSync(filePath, "utf8");
    for (const code of targetCodes) {
      if (source.includes(`"${code}"`)) owners.get(code).push(path.basename(filePath));
    }
  }
  for (const [code, modules] of owners) {
    assert.deepEqual(modules, ["target-resolution.mjs"], code);
  }

  for (const name of ["status-core.mjs", "plan-core.mjs"]) {
    const source = readFileSync(path.join(lifecycleRoot, name), "utf8");
    assert.doesNotMatch(source, /host-support\/index\.mjs/u, name);
    assert.match(source, /target-resolution\.mjs/u, name);
  }
});

test("lifecycle status interprets profiles without canonical host branches", () => {
  const source = readFileSync(path.join(lifecycleRoot, "status-core.mjs"), "utf8");
  for (const hostId of ["claude", "codex", "qoder", "cursor", "qwen", "copilot", "pi", "workbuddy"]) {
    assert.doesNotMatch(source, new RegExp(`["']${hostId}["']`, "u"));
  }
  assert.doesNotMatch(source, /HOME_OPTION|appBundleExists/u);
  assert.match(source, /profile\.inventoryHomeRoutes/u);
  assert.match(source, /observedHostDiscovery/u);
  assert.match(source, /buildObservedStatusRow/u);
  assert.match(source, /buildInventoryFailureStatusRow/u);
  assert.match(source, /buildUnresolvedScopeStatusRow/u);
  assert.doesNotMatch(source, /function (?:verificationFor|evidenceFor|versionState)/u);
  assert.doesNotMatch(source, /\b(?:installation|enablement|activation|checks|evidence):/u);
});

test("lifecycle plan core delegates policy, step materialization, and schema ownership", () => {
  const source = readFileSync(path.join(lifecycleRoot, "plan-core.mjs"), "utf8");
  assert.match(source, /createPluginLifecyclePlan/u);
  assert.match(source, /requirePluginLifecycleAction/u);
  assert.match(source, /resolvePlanTarget/u);
  assert.match(source, /inspectPluginLifecycle/u);
  assert.doesNotMatch(source, /\b(?:planState|blockers|verificationSteps|preconditionDigest|currentObservation|retention|recovery)\b/u);
  assert.doesNotMatch(source, /\.(?:disposition|steps)\b/u);
  assert.doesNotMatch(source, /function (?:renderStep|targetRows|installedState)/u);
});

test("cross-capability lifecycle imports use the public index or pure root metadata", () => {
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
      ) {
        violations.push(`${relativePath} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
