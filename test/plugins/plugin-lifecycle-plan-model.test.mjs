import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

import { listHostProfiles } from "../../scripts/host-support/index.mjs";
import { buildPluginLifecyclePlan } from "../../scripts/plugin-lifecycle/index.mjs";
import {
  PLUGIN_LIFECYCLE_ACTIONS,
  validatePluginLifecyclePlan,
} from "../../scripts/plugin-lifecycle/plan-model.mjs";

const packageInfo = {
  name: "@qoderai/better-harness",
  version: "0.4.0",
  nodeRange: ">=22",
  npmRange: ">=10",
};

const baseOptions = {
  packageInfo,
  hostDiscovery: async () => "present",
  workspace: process.cwd(),
};

function inventoryCollector({ installed = false, scope = "user" } = {}) {
  return async ({ provider }) => ({
    provider,
    plugins: installed
      ? [{
          id: "better-harness",
          name: "better-harness",
          version: "0.4.0",
          enabled: true,
          installSources: [scope],
          skills: [{ name: "better-harness" }],
          evidence: { path: "/fixture/plugin.json" },
        }]
      : [],
    diagnostics: {},
  });
}

async function planFor({
  action = "install",
  host = "qwen",
  surface = "cli",
  scope = "user",
  installed = false,
  workspace = baseOptions.workspace,
  hostHome,
  hostDiscovery = baseOptions.hostDiscovery,
  collector = inventoryCollector({ installed, scope }),
} = {}) {
  return buildPluginLifecyclePlan({
    ...baseOptions,
    action,
    host,
    surface,
    scope,
    workspace,
    hostHome,
    hostDiscovery,
    inventoryCollector: collector,
  });
}

test("every host surface and lifecycle lane emits a validated plan model", async () => {
  let plans = 0;
  for (const profile of listHostProfiles()) {
    for (const surface of profile.surfaces) {
      for (const action of PLUGIN_LIFECYCLE_ACTIONS) {
        for (const installed of [false, true]) {
          const plan = await planFor({
            action,
            host: profile.hostId,
            surface: surface.surfaceId,
            scope: surface.defaultScope,
            installed,
          });
          assert.equal(validatePluginLifecyclePlan(plan), true);
          plans += 1;
        }
      }
    }
  }
  assert.equal(plans, 66);
});

test("mutation and verification steps carry distinct effect contracts", async () => {
  const plan = await planFor({ action: "install", host: "qwen", surface: "cli" });
  assert.equal(plan.state, "ready");
  assert.equal(plan.effects, "none");
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps.every((step) => (
    step.effects === "external"
    && step.externalImpact === "host-plugin-state"
    && step.ownership === "host-native"
  )), true);
  assert.equal(plan.verificationSteps.length, 1);
  assert.equal(plan.verificationSteps.every((step) => (
    step.effects === "read-only"
    && step.externalImpact === "host-observation"
    && step.ownership === "host-native"
    && step.preconditions.every((value) => !value.includes("digest"))
  )), true);
});

test("project and isolated-home plans bind target, digest, step cwd, and verification context", async () => {
  // Plans resolve their inputs, so fixture paths are resolved here too and stay
  // comparable on POSIX and Windows.
  const workspaceOne = path.resolve("/fixture/workspace one");
  const workspaceTwo = path.resolve("/fixture/workspace two");
  const qwenHome = path.resolve("/fixture/qwen home");
  const otherQwenHome = path.resolve("/fixture/other qwen home");
  const first = await planFor({
    scope: "project",
    workspace: workspaceOne,
    hostHome: qwenHome,
  });
  const otherWorkspace = await planFor({
    scope: "project",
    workspace: workspaceTwo,
    hostHome: qwenHome,
  });
  const otherHome = await planFor({
    scope: "project",
    workspace: workspaceOne,
    hostHome: otherQwenHome,
  });

  assert.equal(first.target.workspace, workspaceOne);
  assert.equal(first.target.hostHome, qwenHome);
  assert.equal(first.steps.every((step) => step.cwd === first.target.workspace), true);
  assert.equal(first.verificationSteps.every((step) => step.cwd === first.target.workspace), true);
  assert.equal(first.steps.every((step) => (
    step.homeBinding.variable === "QWEN_HOME"
    && step.homeBinding.value === first.target.hostHome
    && step.homeBinding.contractEvidence.id === "qwen-home-environment"
  )), true);
  assert.equal(first.verificationSteps.every((step) => (
    step.homeBinding.variable === "QWEN_HOME" && step.homeBinding.value === first.target.hostHome
  )), true);
  assert.notEqual(first.preconditionDigest, otherWorkspace.preconditionDigest);
  assert.notEqual(first.planId, otherWorkspace.planId);
  assert.notEqual(first.preconditionDigest, otherHome.preconditionDigest);
  assert.notEqual(first.planId, otherHome.planId);

  const user = await planFor({ hostHome: qwenHome });
  assert.equal(Object.hasOwn(user.target, "workspace"), false);
  assert.equal(user.steps.every((step) => !Object.hasOwn(step, "cwd")), true);
  assert.equal(user.verificationSteps.every((step) => !Object.hasOwn(step, "cwd")), true);
});

test("inventory failure and an absent required host executable block plans", async () => {
  for (const action of PLUGIN_LIFECYCLE_ACTIONS) {
    const inventoryFailure = await planFor({
      action,
      installed: action !== "install",
      collector: async () => {
        throw new Error("fixture inventory failure");
      },
    });
    assert.equal(inventoryFailure.state, "blocked", action);
    assert.equal(inventoryFailure.status, "failed", action);
    assert.deepEqual(inventoryFailure.steps, [], action);
    assert.ok(
      inventoryFailure.blockers.some((item) => item.code === "INVENTORY_COLLECTION_FAILED"),
      action,
    );

    const absentExecutable = await planFor({
      action,
      host: "copilot",
      installed: action !== "install",
      hostDiscovery: async () => "absent",
    });
    assert.equal(absentExecutable.state, "blocked", action);
    assert.deepEqual(absentExecutable.steps, [], action);
    assert.ok(
      absentExecutable.blockers.some((item) => item.code === "HOST_EXECUTABLE_NOT_FOUND"),
      action,
    );
  }
});

test("public plan calls normalize relative workspace and host home before observation", async () => {
  let captured;
  const plan = await planFor({
    scope: "project",
    workspace: ".",
    hostHome: "fixture-relative-qwen-home",
    collector: async (options) => {
      captured = options;
      return { provider: options.provider, plugins: [], diagnostics: {} };
    },
  });
  assert.equal(plan.target.workspace, process.cwd());
  assert.equal(plan.target.hostHome, path.resolve("fixture-relative-qwen-home"));
  assert.equal(captured.workspace, plan.target.workspace);
  assert.equal(captured.qwenHome, plan.target.hostHome);
  assert.equal(plan.steps[0].cwd, plan.target.workspace);
  assert.equal(plan.steps[0].homeBinding.value, plan.target.hostHome);
});

test("unrepresentable scopes and Qwen shared-artifact mutations stay blocked", async () => {
  const unresolved = await planFor({
    action: "install",
    host: "qoder",
    surface: "cli",
    collector: inventoryCollector({ installed: true, scope: "other" }),
  });
  assert.equal(unresolved.state, "blocked");
  assert.ok(unresolved.blockers.some((item) => item.code === "INSTALL_SCOPE_UNSUPPORTED"));

  const mixed = await planFor({
    collector: async ({ provider }) => ({
      provider,
      plugins: [{
        id: "better-harness",
        name: "better-harness",
        installSources: ["user", "future-scope"],
        skills: [{ name: "better-harness" }],
      }],
      diagnostics: {},
    }),
  });
  assert.equal(mixed.state, "blocked");
  assert.ok(mixed.blockers.some((item) => item.code === "INSTALL_SCOPE_UNSUPPORTED"));

  for (const action of ["update", "remove"]) {
    const unavailable = await planFor({ action, installed: false });
    assert.equal(unavailable.state, "blocked", action);
    assert.ok(
      unavailable.blockers.some((item) => item.code === "LIFECYCLE_OPERATION_UNAVAILABLE"),
      action,
    );
  }
});

test("Qwen blocks shared-artifact installs across activation scopes", async () => {
  for (const [scope, observedScope] of [["project", "user"], ["user", "project"]]) {
    const plan = await planFor({
      scope,
      collector: inventoryCollector({ installed: true, scope: observedScope }),
    });
    assert.equal(plan.state, "blocked", `${observedScope}->${scope}`);
    assert.equal(plan.status, "failed", `${observedScope}->${scope}`);
    assert.ok(
      plan.blockers.some((item) => item.code === "SHARED_ARTIFACT_SCOPE_CONFLICT"),
      `${observedScope}->${scope}`,
    );
  }
});

test("unsupported CLI scope evidence cannot contaminate a bundled desktop plan", async () => {
  const plan = await planFor({
    action: "install",
    host: "qoder",
    surface: "desktop",
    scope: "bundled",
    collector: inventoryCollector({ installed: true, scope: "future-cli-scope" }),
  });
  assert.equal(plan.state, "noop");
  assert.equal(plan.status, "ok");
  assert.equal(plan.blockers.length, 0);
});

test("isolated plans fail closed when native steps cannot bind every host home root", async () => {
  const plan = await planFor({
    action: "install",
    host: "copilot",
    surface: "cli",
    hostHome: "relative-copilot-home",
  });
  assert.equal(plan.state, "blocked");
  assert.equal(plan.status, "failed");
  assert.deepEqual(plan.steps, []);
  assert.deepEqual(plan.verificationSteps, []);
  assert.ok(plan.blockers.some((item) => item.code === "ISOLATED_HOST_HOME_UNREPRESENTABLE"));

  const claudeInstall = await planFor({
    action: "install",
    host: "claude",
    surface: "cli",
    hostHome: "relative-claude-home",
  });
  assert.equal(claudeInstall.state, "blocked");
  assert.deepEqual(claudeInstall.steps, []);
  assert.ok(claudeInstall.blockers.some((item) => item.code === "ISOLATED_HOST_HOME_UNREPRESENTABLE"));

  const claudeUpdate = await planFor({
    action: "update",
    host: "claude",
    surface: "cli",
    installed: true,
    hostHome: "relative-claude-home",
  });
  assert.equal(claudeUpdate.state, "ready");
  assert.equal(claudeUpdate.steps[0].homeBinding.variable, "CLAUDE_CONFIG_DIR");
});

test("unavailable operation disposition remains explicit when the host is absent", async () => {
  for (const action of ["update", "remove"]) {
    const plan = await planFor({
      action,
      installed: false,
      hostDiscovery: async () => "absent",
    });
    assert.equal(plan.state, "blocked");
    assert.equal(plan.blockers[0].code, "LIFECYCLE_OPERATION_UNAVAILABLE");
  }
});

test("plan validation rejects controlled-state, summary, digest, and step drift", async () => {
  const ready = await planFor({ action: "install", host: "qwen", surface: "cli" });
  const corruptions = [
    [(plan) => { plan.action = "apply"; }, /action/u],
    [(plan) => { plan.state = "pending"; }, /state/u],
    [(plan) => { plan.status = "partial"; }, /command status/u],
    [(plan) => { plan.effects = "external"; }, /generation must remain read-only/u],
    [(plan) => { plan.planId = "0".repeat(64); }, /plan digest is stale/u],
    [(plan) => { plan.preconditionDigest = "0".repeat(64); }, /precondition digest is stale/u],
    [(plan) => { plan.currentObservation.instances += 1; }, /observation count/u],
    [(plan) => { plan.currentObservation.installations = []; }, /installation summary/u],
    [(plan) => { plan.target.hostId = "claude"; }, /observed host/u],
    [(plan) => { plan.target.distributionKind = "package"; }, /observed distribution/u],
    [(plan) => { plan.target.workspace = "/other/workspace"; }, /target workspace/u],
    [(plan) => { plan.steps[0].cwd = "/other/workspace"; }, /cannot declare a workspace/u],
    [(plan) => { plan.steps[0].effects = "read-only"; }, /mutation step 1 has invalid effects/u],
    [(plan) => { plan.steps[0].command = "qwen extensions install"; }, /exactly one typed instruction/u],
    [(plan) => { plan.verificationSteps[0].externalImpact = "host-plugin-state"; }, /verification step 1 has invalid external impact/u],
    [(plan) => { plan.steps = []; }, /ready plan requires mutation steps/u],
    [(plan) => { plan.retention.pop(); }, /retention boundaries/u],
    [(plan) => { plan.activation.newSessionRequired = false; }, /activation requirement/u],
    [(plan) => { plan.recovery.pop(); }, /recovery boundaries/u],
    [(plan) => { plan.observed[0].installation = "present"; }, /installation/u],
  ];
  for (const [mutate, pattern] of corruptions) {
    const candidate = structuredClone(ready);
    mutate(candidate);
    assert.throws(() => validatePluginLifecyclePlan(candidate), pattern);
  }

  const blocked = await planFor({ action: "update", host: "qwen", surface: "cli" });
  const invalidSeverity = structuredClone(blocked);
  invalidSeverity.blockers[0].severity = "fatal";
  assert.throws(() => validatePluginLifecyclePlan(invalidSeverity), /diagnostic severity/u);

  const mismatchedDiagnostics = structuredClone(blocked);
  mismatchedDiagnostics.diagnostics = [
    ...mismatchedDiagnostics.diagnostics,
    { code: "EXTRA", severity: "warning", message: "extra" },
  ];
  assert.throws(() => validatePluginLifecyclePlan(mismatchedDiagnostics), /diagnostics must mirror blockers/u);

  const blockerless = structuredClone(blocked);
  blockerless.blockers = [];
  blockerless.diagnostics = [];
  assert.throws(() => validatePluginLifecyclePlan(blockerless), /blocked plan requires a blocker/u);

  const readyWithBlocker = structuredClone(ready);
  readyWithBlocker.blockers = [{ code: "EXTRA", severity: "error", message: "extra" }];
  readyWithBlocker.diagnostics = structuredClone(readyWithBlocker.blockers);
  assert.throws(() => validatePluginLifecyclePlan(readyWithBlocker), /ready plan cannot contain blockers/u);

  const isolated = await planFor({ hostHome: "/fixture/qwen-home" });
  const mismatchedHome = structuredClone(isolated);
  mismatchedHome.steps[0].homeBinding.value = "/fixture/other-home";
  assert.throws(() => validatePluginLifecyclePlan(mismatchedHome), /host home binding differs/u);

  const missingBindingEvidence = structuredClone(isolated);
  missingBindingEvidence.steps[0].homeBinding.contractEvidence.fixture = "";
  assert.throws(() => validatePluginLifecyclePlan(missingBindingEvidence), /binding evidence fixture is missing/u);

  const hostCommandBinding = structuredClone(isolated);
  hostCommandBinding.steps[0].kind = "host-command";
  hostCommandBinding.steps[0].command = "extensions install better-harness";
  delete hostCommandBinding.steps[0].argv;
  assert.throws(() => validatePluginLifecyclePlan(hostCommandBinding), /cannot bind host home for host-command/u);
});

test("direct plan callers use the same controlled lifecycle action contract", async () => {
  await assert.rejects(
    planFor({ action: "apply" }),
    (error) => error.code === "UNKNOWN_LIFECYCLE_ACTION" && error.kind === "usage",
  );
});
