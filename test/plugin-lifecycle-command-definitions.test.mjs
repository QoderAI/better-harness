import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { groupCommand } from "../scripts/better-harness-cli/registry.mjs";
import {
  PLUGIN_COMMAND_DEFINITIONS,
  pluginCommandNames,
  requirePluginCommandDefinition,
} from "../scripts/plugin-lifecycle/command-definitions.mjs";
import { PLUGIN_COMMAND_MANIFEST } from "../scripts/plugin-lifecycle/command-manifest.mjs";
import { renderPlan, renderStatus } from "../scripts/plugin-lifecycle/human-output.mjs";
import { PLUGIN_LIFECYCLE_ACTIONS } from "../scripts/plugin-lifecycle/plan-model.mjs";

test("one plugin command manifest projects into root discovery and runtime bindings", () => {
  const manifestSource = readFileSync(
    new URL("../scripts/plugin-lifecycle/command-manifest.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(manifestSource, /^import\s/mu);
  const rootRegistrySource = readFileSync(
    new URL("../scripts/better-harness-cli/registry.mjs", import.meta.url),
    "utf8",
  );
  assert.match(rootRegistrySource, /plugin-lifecycle\/command-manifest\.mjs/u);
  assert.doesNotMatch(rootRegistrySource, /plugin-lifecycle\/index\.mjs/u);
  assert.deepEqual(pluginCommandNames(), ["status", "plan", "verify"]);
  assert.deepEqual(
    PLUGIN_COMMAND_MANIFEST.find((entry) => entry.name === "plan").positionals.values,
    PLUGIN_LIFECYCLE_ACTIONS,
  );
  assert.deepEqual(
    groupCommand("plugin").subcommands,
    PLUGIN_COMMAND_MANIFEST.map(({ name, audience, entryScript: script, summary }) => ({
      name,
      audience,
      script,
      summary,
    })),
  );
  assert.deepEqual(
    PLUGIN_COMMAND_DEFINITIONS.map((definition) => definition.name),
    pluginCommandNames(),
  );
  for (const definition of PLUGIN_COMMAND_DEFINITIONS) {
    assert.equal(Object.isFrozen(definition), true);
    assert.equal(Object.isFrozen(definition.allowedOptions), true);
    assert.equal(Object.isFrozen(definition.positionals), true);
    assert.equal(typeof definition.execute, "function");
    assert.equal(typeof definition.renderHuman, "function");
    assert.equal(requirePluginCommandDefinition(definition.name), definition);
  }
  assert.throws(
    () => requirePluginCommandDefinition("apply"),
    (error) => error.code === "UNKNOWN_PLUGIN_COMMAND" && error.kind === "usage",
  );
});

test("plugin CLI dispatches definitions without leaf-name conditionals", () => {
  const source = readFileSync(
    new URL("../scripts/plugin-lifecycle/cli.mjs", import.meta.url),
    "utf8",
  );
  for (const command of pluginCommandNames()) {
    assert.doesNotMatch(
      source,
      new RegExp(`command\\s*[!=]==?\\s*["']${command}["']`, "u"),
      command,
    );
  }
  assert.match(source, /requirePluginCommandDefinition/u);
  assert.match(source, /execute: definition\.execute/u);
  assert.match(source, /definition\.renderHuman/u);
});

test("extracted status human output preserves tables and diagnostic filtering", () => {
  const output = renderStatus({
    rows: [{
      target: { hostId: "qwen", surfaceId: "cli", scope: "user" },
      hostDiscovery: "present",
      installation: "installed",
      enablement: "enabled",
      version: { observed: "0.4.0", relation: "same" },
      verification: "partial",
    }],
    diagnostics: [
      { code: "RUNTIME_ACTIVATION_UNOBSERVED", severity: "info", message: "info" },
      { code: "PLUGIN_DISABLED", severity: "warning", message: "disabled" },
    ],
  }, { name: "status" });

  assert.equal(output, [
    "Better Harness plugin status",
    "",
    "TARGET         HOST     INSTALL    ENABLE   VERSION       VERIFY",
    "qwen/cli@user  present  installed  enabled  0.4.0 (same)  partial",
    "",
    "Diagnostics:",
    "  PLUGIN_DISABLED: disabled",
    "",
  ].join("\n"));
});

test("human output escapes control characters from local evidence and paths", () => {
  const status = renderStatus({
    rows: [{
      target: { hostId: "qwen", surfaceId: "cli", scope: "user" },
      hostDiscovery: "present",
      installation: "installed",
      enablement: "enabled",
      version: { observed: "0.4.0\n\u001b[31mspoof", relation: "different" },
      verification: "partial",
    }],
    diagnostics: [],
  }, { name: "status" });
  assert.match(status, /0\.4\.0\\n\\u001b\[31mspoof \(different\)/u);
  assert.equal(status.includes("\u001b"), false);
  assert.equal(status.split("\n").some((line) => line === "spoof (different)"), false);

  const plan = renderPlan({
    action: "install",
    planId: "plan-1",
    target: {
      hostId: "qwen",
      surfaceId: "cli",
      scope: "project",
      workspace: "/workspace/line\nbreak",
    },
    state: "ready",
    effects: "none",
    steps: [],
    verificationSteps: [],
    notes: [],
    blockers: [],
  });
  assert.match(plan, /Workspace: "\/workspace\/line\\nbreak"/u);
  assert.equal(plan.includes("/workspace/line\nbreak"), false);
});

test("extracted plan human output preserves argv as shell-neutral JSON data", () => {
  const output = renderPlan({
    action: "install",
    planId: "plan-1",
    target: {
      hostId: "qwen",
      surfaceId: "cli",
      scope: "project",
      workspace: "/workspace/path with space",
      hostHome: "/host home/qwen",
    },
    state: "ready",
    effects: "none",
    steps: [{
      id: "step-1",
      kind: "shell",
      argv: ["qwen", "extensions", "install", "path with space"],
      cwd: "/workspace/path with space",
      expected: "installed",
    }],
    verificationSteps: [{
      kind: "shell",
      argv: ["qwen", "extensions", "list"],
      cwd: "/workspace/path with space",
    }],
    notes: [],
    blockers: [],
  });

  assert.equal(output, [
    "Better Harness plugin install plan",
    "",
    "Plan: plan-1",
    "Target: qwen/cli@project",
    "State: ready",
    "Effects performed now: none",
    "Workspace: \"/workspace/path with space\"",
    "Host home: \"/host home/qwen\"",
    "",
    "Planned external steps:",
    "  step-1. [shell] argv (JSON, not shell): [\"qwen\",\"extensions\",\"install\",\"path with space\"]",
    "     Expect: installed",
    "     Working directory: \"/workspace/path with space\"",
    "",
    "Verify after applying externally:",
    "  - [shell] argv (JSON, not shell): [\"qwen\",\"extensions\",\"list\"]",
    "    Working directory: \"/workspace/path with space\"",
    "  - Better Harness verify argv (JSON, not shell): [\"better-harness\",\"plugin\",\"verify\",\"--host\",\"qwen\",\"--surface\",\"cli\",\"--workspace\",\"/workspace/path with space\",\"--host-home\",\"/host home/qwen\"]",
    "",
    "No commands were executed and no files were changed.",
    "",
  ].join("\n"));
});

test("plan human output neutralizes shell expansion syntax in argv and paths", () => {
  const hostilePath = "/workspace/$(touch pwn)-`touch pwn2`-%TEMP%-!TEMP!-$env:HOME";
  const output = renderPlan({
    action: "install",
    planId: "plan-hostile",
    target: {
      hostId: "qwen",
      surfaceId: "cli",
      scope: "project",
      workspace: hostilePath,
      hostHome: hostilePath,
    },
    state: "ready",
    effects: "none",
    steps: [{
      id: "step-1",
      kind: "shell",
      argv: ["qwen", "extensions", "install", hostilePath],
      cwd: hostilePath,
      expected: "installed",
      homeBinding: {
        variable: "QWEN_HOME",
        value: hostilePath,
        contractEvidence: { id: "fixture", observedAt: "2026-08-01" },
      },
    }],
    verificationSteps: [],
    notes: [],
    blockers: [],
  });

  assert.match(output, /argv \(JSON, not shell\): \["qwen","extensions","install"/u);
  assert.match(output, /Host home binding \(data\): \{"variable":"QWEN_HOME","value":/u);
  assert.equal(output.includes("$("), false);
  assert.equal(output.includes("`"), false);
  assert.equal(output.includes("%TEMP%"), false);
  assert.equal(output.includes("!TEMP!"), false);
  assert.equal(output.includes("$env:"), false);
  assert.doesNotMatch(output, /^\s*(?:qwen|better-harness)\s+/imu);
  assert.doesNotMatch(output, /QWEN_HOME=/u);
});
