import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assertLifecycleControlled,
  validateLifecycleDiagnostics,
  validateLifecyclePlugin,
  validateLifecycleTarget,
} from "../../scripts/plugin-lifecycle/model.mjs";

test("shared lifecycle plugin validation owns both version-field variants", () => {
  assert.equal(validateLifecyclePlugin(
    { id: "better-harness", expectedVersion: "0.4.0" },
    { label: "PluginLifecycleStatusV1", versionField: "expectedVersion", versionLabel: "expected version" },
  ), true);
  assert.equal(validateLifecyclePlugin(
    { id: "better-harness", packageVersion: "0.4.0" },
    { label: "PluginLifecyclePlanV1", versionField: "packageVersion", versionLabel: "package version" },
  ), true);
  assert.throws(
    () => validateLifecyclePlugin(
      { id: "display-name-only", expectedVersion: "0.4.0" },
      { label: "PluginLifecycleStatusV1", versionField: "expectedVersion", versionLabel: "expected version" },
    ),
    /plugin identity/u,
  );
  assert.throws(
    () => validateLifecyclePlugin(
      { id: "better-harness" },
      { label: "PluginLifecyclePlanV1", versionField: "packageVersion", versionLabel: "package version" },
    ),
    /package version/u,
  );
});

test("shared lifecycle target validation distinguishes base and expected-source contracts", () => {
  const target = {
    hostId: "qwen",
    surfaceId: "cli",
    scope: "user",
    distributionKind: "extension",
  };
  assert.equal(validateLifecycleTarget(target, { label: "PluginLifecycleStatusV1" }), true);
  assert.throws(
    () => validateLifecycleTarget(target, { label: "PluginLifecyclePlanV1", expectedSource: true }),
    /native plugin id/u,
  );
  assert.equal(validateLifecycleTarget({
    ...target,
    expectedSource: {
      pluginId: "better-harness",
      repository: "QoderAI/better-harness",
    },
  }, { label: "PluginLifecyclePlanV1", expectedSource: true }), true);
  assert.throws(
    () => validateLifecycleTarget({ ...target, scope: "" }, { label: "PluginLifecycleStatusV1" }),
    /scope/u,
  );
});

test("shared lifecycle diagnostics enforce one shape and severity vocabulary", () => {
  const diagnostics = [
    { code: "INFO", severity: "info", message: "info" },
    { code: "WARN", severity: "warning", message: "warning" },
    { code: "ERROR", severity: "error", message: "error" },
  ];
  assert.equal(validateLifecycleDiagnostics(diagnostics, "ContractV1"), true);
  assert.throws(
    () => validateLifecycleDiagnostics([{ code: "DEBUG", severity: "debug", message: "debug" }], "ContractV1"),
    /diagnostic severity/u,
  );
  assert.throws(
    () => validateLifecycleDiagnostics([{ code: "", severity: "error", message: "error" }], "ContractV1"),
    /diagnostic code/u,
  );
  assert.throws(() => validateLifecycleDiagnostics({}, "ContractV1"), /must be an array/u);
  assert.throws(
    () => assertLifecycleControlled(["ready", "blocked"], "pending", "ContractV1", "state"),
    /ContractV1 state/u,
  );
});
