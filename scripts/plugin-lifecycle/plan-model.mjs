import path from "node:path";

import { LifecycleCliError, diagnostic } from "./contract.mjs";
import { stableDigest } from "./identity.mjs";
import {
  assertLifecycle,
  assertLifecycleControlled,
  assertLifecycleString,
  PLUGIN_LIFECYCLE_SCHEMA_VERSION,
  validateLifecycleDiagnostics,
  validateLifecyclePlugin,
  validateLifecycleTarget,
} from "./model.mjs";
import { validatePluginLifecycleStatusRow } from "./status-row.mjs";

export const PLUGIN_LIFECYCLE_ACTIONS = Object.freeze(["install", "update", "remove"]);

const PLAN_STATES = Object.freeze(["ready", "noop", "manual", "blocked"]);
const PLAN_STATUSES = Object.freeze(["ok", "partial", "failed"]);
const STEP_KINDS = Object.freeze(["shell", "manual", "host-command", "desktop-ui"]);
const RETENTION_BOUNDARIES = Object.freeze([
  "configured marketplace",
  "Better Harness reports",
  "host caches not owned by plugin removal",
  "Better Harness CLI package",
  "source checkout",
]);
const RECOVERY_STEPS = Object.freeze([
  "Stop before any remaining external step if the observed preconditions change.",
  "Run the read-only verify command to capture the resulting local state.",
  "Use only the host's native repair or reinstall route; Better Harness does not roll back host state.",
]);

function assertControlled(values, value, family) {
  assertLifecycleControlled(values, value, "PluginLifecyclePlanV1", family);
}

function stepRepresentation(step) {
  return [step.argv, step.command, step.instruction].filter((value) => value != null);
}

function validatePlanStep(step, index, phase, target) {
  const label = `PluginLifecyclePlanV1 ${phase} step ${index + 1}`;
  assertLifecycle(step && typeof step === "object", `${label} must be an object.`);
  assertLifecycle(step.id === `step-${index + 1}`, `${label} has an invalid id.`);
  assertControlled(STEP_KINDS, step.kind, "step kind");
  assertLifecycle(stepRepresentation(step).length === 1, `${label} must have exactly one typed instruction.`);
  if (step.kind === "shell") {
    assertLifecycle(Array.isArray(step.argv) && step.argv.length > 0, `${label} requires argv.`);
    assertLifecycle(step.argv.every((value) => typeof value === "string"), `${label} argv must contain only strings.`);
  } else if (step.kind === "host-command") {
    assertLifecycleString(step.command, `${label} requires a host command.`);
  } else {
    assertLifecycleString(step.instruction, `${label} requires an instruction.`);
  }
  assertLifecycleString(step.expected, `${label} expected result is missing.`);
  const expectedEffects = phase === "mutation" ? "external" : "read-only";
  const expectedImpact = phase === "mutation" ? "host-plugin-state" : "host-observation";
  assertLifecycle(step.effects === expectedEffects, `${label} has invalid effects.`);
  assertLifecycle(step.externalImpact === expectedImpact, `${label} has invalid external impact.`);
  assertLifecycle(step.ownership === "host-native", `${label} must remain host-native.`);
  assertLifecycle(Array.isArray(step.preconditions) && step.preconditions.length > 0, `${label} requires preconditions.`);
  assertLifecycle(step.preconditions.every((value) => typeof value === "string" && value.length > 0), `${label} preconditions must be strings.`);
  if (step.homeBinding != null) {
    assertLifecycle(target.hostHome != null, `${label} cannot bind an unspecified host home.`);
    assertLifecycle(
      step.homeBinding && typeof step.homeBinding === "object" && !Array.isArray(step.homeBinding),
      `${label} has an invalid host home binding.`,
    );
    assertLifecycle(step.homeBinding.kind === "environment", `${label} has an invalid host home binding kind.`);
    assertLifecycle(
      typeof step.homeBinding.variable === "string" && /^[A-Z_][A-Z0-9_]*$/u.test(step.homeBinding.variable),
      `${label} has an invalid host home environment variable.`,
    );
    assertLifecycle(step.homeBinding.value === target.hostHome, `${label} host home binding differs from its target.`);
    assertLifecycle(step.kind === "shell", `${label} cannot bind host home for ${step.kind}.`);
    const evidence = step.homeBinding.contractEvidence;
    assertLifecycle(evidence && typeof evidence === "object", `${label} host home binding lacks contract evidence.`);
    assertLifecycleString(evidence.id, `${label} host home binding evidence id is missing.`);
    assertLifecycleString(evidence.kind, `${label} host home binding evidence kind is missing.`);
    assertLifecycle(/^\d{4}-\d{2}-\d{2}$/u.test(evidence.observedAt), `${label} host home binding evidence date is invalid.`);
    assertLifecycleString(evidence.fixture, `${label} host home binding evidence fixture is missing.`);
  } else if (target.hostHome != null) {
    assertLifecycle(false, `${label} must bind the isolated host home.`);
  }
  if (["project", "local"].includes(target.scope)) {
    assertLifecycle(step.cwd === target.workspace, `${label} must use the target workspace.`);
  } else {
    assertLifecycle(step.cwd == null, `${label} cannot declare a workspace for ${target.scope} scope.`);
  }
}

function planCoreForDigest(plan) {
  const { planId: _planId, status: _status, diagnostics: _diagnostics, ...core } = plan;
  return core;
}

function preconditionCoreForDigest(plan) {
  return {
    target: plan.target,
    observed: plan.observed,
  };
}

export function validatePluginLifecyclePlan(plan) {
  assertLifecycle(plan && typeof plan === "object", "PluginLifecyclePlanV1 plan must be an object.");
  assertLifecycle(plan.kind === "better-harness-plugin-plan", "Invalid PluginLifecyclePlanV1 kind.");
  assertLifecycle(plan.schemaVersion === PLUGIN_LIFECYCLE_SCHEMA_VERSION, "Invalid PluginLifecyclePlanV1 schema version.");
  validateLifecyclePlugin(plan.plugin, {
    label: "PluginLifecyclePlanV1",
    versionField: "packageVersion",
    versionLabel: "package version",
  });
  assertControlled(PLUGIN_LIFECYCLE_ACTIONS, plan.action, "action");
  validateLifecycleTarget(plan.target, { label: "PluginLifecyclePlanV1", expectedSource: true });
  if (["project", "local"].includes(plan.target.scope)) {
    assertLifecycleString(plan.target.workspace, "PluginLifecyclePlanV1 target workspace is missing.");
    assertLifecycle(path.isAbsolute(plan.target.workspace), "PluginLifecyclePlanV1 target workspace must be absolute.");
  } else {
    assertLifecycle(plan.target.workspace == null, "PluginLifecyclePlanV1 target workspace is valid only for project or local scope.");
  }
  if (plan.target.hostHome != null) {
    assertLifecycleString(plan.target.hostHome, "PluginLifecyclePlanV1 target host home is invalid.");
    assertLifecycle(path.isAbsolute(plan.target.hostHome), "PluginLifecyclePlanV1 target host home must be absolute.");
  }
  assertControlled(PLAN_STATES, plan.state, "state");
  assertLifecycle(/^[a-f0-9]{64}$/u.test(plan.preconditionDigest), "Invalid PluginLifecyclePlanV1 precondition digest.");
  assertLifecycle(Array.isArray(plan.observed), "PluginLifecyclePlanV1 observed rows must be an array.");
  for (const row of plan.observed) {
    validatePluginLifecycleStatusRow(row);
    assertLifecycle(row.target.hostId === plan.target.hostId, "PluginLifecyclePlanV1 observed host differs from its target.");
    assertLifecycle(row.target.surfaceId === plan.target.surfaceId, "PluginLifecyclePlanV1 observed surface differs from its target.");
    assertLifecycle(
      row.target.distributionKind === plan.target.distributionKind,
      "PluginLifecyclePlanV1 observed distribution differs from its target.",
    );
    assertLifecycle(
      row.target.scope === plan.target.scope || plan.target.distributionKind === "bundled",
      "PluginLifecyclePlanV1 observed scope differs from its target.",
    );
  }
  assertLifecycle(plan.preconditionDigest === stableDigest(preconditionCoreForDigest(plan)), "PluginLifecyclePlanV1 precondition digest is stale.");
  assertLifecycle(plan.currentObservation?.instances === plan.observed.length, "PluginLifecyclePlanV1 observation count is inconsistent.");
  assertLifecycle(
    stableDigest(plan.currentObservation.installations) === stableDigest(plan.observed.map((row) => row.installation)),
    "PluginLifecyclePlanV1 installation summary is inconsistent.",
  );
  assertLifecycle(
    stableDigest(plan.currentObservation.verification) === stableDigest(plan.observed.map((row) => row.verification)),
    "PluginLifecyclePlanV1 verification summary is inconsistent.",
  );
  assertLifecycle(Array.isArray(plan.steps), "PluginLifecyclePlanV1 mutation steps must be an array.");
  assertLifecycle(Array.isArray(plan.verificationSteps), "PluginLifecyclePlanV1 verification steps must be an array.");
  plan.steps.forEach((step, index) => validatePlanStep(step, index, "mutation", plan.target));
  plan.verificationSteps.forEach((step, index) => validatePlanStep(step, index, "verification", plan.target));
  if (["blocked", "noop"].includes(plan.state)) {
    assertLifecycle(plan.steps.length === 0, `PluginLifecyclePlanV1 ${plan.state} plan cannot contain mutation steps.`);
  } else {
    assertLifecycle(plan.steps.length > 0, `PluginLifecyclePlanV1 ${plan.state} plan requires mutation steps.`);
  }
  validateLifecycleDiagnostics(plan.blockers, "PluginLifecyclePlanV1 blocker");
  if (plan.state === "blocked") {
    assertLifecycle(plan.blockers.length > 0, "PluginLifecyclePlanV1 blocked plan requires a blocker.");
  } else {
    assertLifecycle(plan.blockers.length === 0, `PluginLifecyclePlanV1 ${plan.state} plan cannot contain blockers.`);
  }
  assertLifecycle(Array.isArray(plan.notes) && plan.notes.every((value) => typeof value === "string"), "PluginLifecyclePlanV1 notes must be strings.");
  assertLifecycle(stableDigest(plan.retention) === stableDigest(RETENTION_BOUNDARIES), "PluginLifecyclePlanV1 retention boundaries changed.");
  assertLifecycle(plan.activation?.newSessionRequired === ["ready", "manual"].includes(plan.state), "PluginLifecyclePlanV1 activation requirement is inconsistent.");
  assertLifecycleString(plan.activation.instruction, "PluginLifecyclePlanV1 activation instruction is missing.");
  assertLifecycle(stableDigest(plan.recovery) === stableDigest(RECOVERY_STEPS), "PluginLifecyclePlanV1 recovery boundaries changed.");
  assertLifecycle(plan.effects === "none", "PluginLifecyclePlanV1 generation must remain read-only.");
  const expectedStatus = plan.state === "blocked" ? "failed" : (plan.state === "manual" ? "partial" : "ok");
  assertControlled(PLAN_STATUSES, plan.status, "status");
  assertLifecycle(plan.status === expectedStatus, "PluginLifecyclePlanV1 command status is inconsistent.");
  validateLifecycleDiagnostics(plan.diagnostics, "PluginLifecyclePlanV1");
  assertLifecycle(stableDigest(plan.diagnostics) === stableDigest(plan.blockers), "PluginLifecyclePlanV1 diagnostics must mirror blockers.");
  assertLifecycle(plan.planId === stableDigest(planCoreForDigest(plan)), "PluginLifecyclePlanV1 plan digest is stale.");
  return true;
}

export function requirePluginLifecycleAction(value) {
  const action = String(value ?? "");
  if (PLUGIN_LIFECYCLE_ACTIONS.includes(action)) return action;
  throw new LifecycleCliError(
    "UNKNOWN_LIFECYCLE_ACTION",
    `Unknown lifecycle action: ${action || "<missing>"}`,
    { kind: "usage", hint: `Use ${PLUGIN_LIFECYCLE_ACTIONS.join(", ")}.` },
  );
}

function stepCanBindHostHome(step, surface) {
  return surface.nativeHomeBinding != null && step.kind === "shell";
}

function stepsCanBindHostHome(steps, surface, hostHome) {
  return !hostHome || steps.every((step) => stepCanBindHostHome(step, surface));
}

function materializeStep(step, surface, scope, workspace, hostHome, index, phase) {
  const scopeValue = surface.scopeValues?.[scope] ?? scope;
  const replace = (value) => value.replaceAll("{scope}", scope).replaceAll("{scopeValue}", scopeValue);
  const mutation = phase === "mutation";
  return {
    id: `step-${index + 1}`,
    kind: step.kind,
    ...(step.argv ? { argv: step.argv.map(replace) } : {}),
    ...(step.command ? { command: replace(step.command) } : {}),
    ...(step.instruction ? { instruction: replace(step.instruction) } : {}),
    expected: replace(step.expected),
    externalImpact: mutation ? "host-plugin-state" : "host-observation",
    effects: mutation ? "external" : "read-only",
    ownership: "host-native",
    ...(hostHome ? {
      homeBinding: {
        kind: surface.nativeHomeBinding.kind,
        variable: surface.nativeHomeBinding.variable,
        value: hostHome,
        contractEvidence: surface.nativeHomeBinding.contractEvidence,
      },
    } : {}),
    ...(["project", "local"].includes(scope) ? { cwd: workspace } : {}),
    preconditions: mutation
      ? [
          "The precondition digest still matches current local evidence.",
          "The user explicitly chooses to run this host-native step outside Better Harness.",
        ]
      : [
          "The planned external lifecycle steps were completed or intentionally skipped.",
          "The user explicitly chooses to run this host-native observation outside Better Harness.",
        ],
  };
}

function targetRows(observed, surface, scope) {
  return observed.rows.filter((row) => (
    row.target.surfaceId === surface.surfaceId
    && (row.target.scope === scope || surface.distributionKind === "bundled")
  ));
}

function installedState(rows) {
  return rows.some((row) => ["installed", "bundled"].includes(row.installation));
}

function installationState(rows) {
  if (installedState(rows)) return "installed";
  if (rows.some((row) => ["unknown", "session-only"].includes(row.installation))) {
    return "unknown";
  }
  return "not-installed";
}

function observationBlockers({ action, profile, surface, scope, observed }) {
  const surfaceRows = observed.rows.filter((row) => row.target.surfaceId === surface.surfaceId);
  const observationFailure = surfaceRows.flatMap((row) => row.diagnostics).find((item) => (
    ["INVENTORY_COLLECTION_FAILED", "INSTALL_SCOPE_UNSUPPORTED"].includes(item.code)
  ));
  if (observationFailure) return [observationFailure];

  const selectedRows = targetRows(observed, surface, scope);
  if (
    action === "install"
    && surface.scopeArtifactPolicy === "shared"
    && !installedState(selectedRows)
    && installedState(surfaceRows)
  ) {
    return [diagnostic(
      "SHARED_ARTIFACT_SCOPE_CONFLICT",
      "error",
      `${profile.displayName} already has the shared plugin artifact installed at another activation scope.`,
    )];
  }
  const operation = surface.lifecycle[action];
  const requiresHost = operation.steps.length > 0 && surface.distributionKind !== "bundled";
  if (requiresHost && surfaceRows.some((row) => row.hostDiscovery === "absent")) {
    return [diagnostic(
      "HOST_EXECUTABLE_NOT_FOUND",
      "error",
      `${profile.displayName} requires an available host executable before ${action} can be planned.`,
    )];
  }
  return [];
}

function transitionFor({ action, profile, surface, installation, hostHome, preflightBlockers }) {
  const observationBlockers = preflightBlockers.filter((item) => item.code !== "HOST_EXECUTABLE_NOT_FOUND");
  if (observationBlockers.length > 0) {
    return {
      state: "blocked",
      blockers: observationBlockers,
    };
  }
  const operation = surface.lifecycle[action];
  if (!profile.managed) {
    return {
      state: "blocked",
      blockers: [diagnostic(
        "PLUGIN_LIFECYCLE_UNSUPPORTED",
        "error",
        `${profile.displayName} has no managed Better Harness lifecycle surface.`,
      )],
    };
  }
  if (operation.disposition === "unavailable") {
    const stale = operation.contractEvidence?.kind === "contract-drift";
    return {
      state: "blocked",
      blockers: [diagnostic(
        stale ? "HOST_CONTRACT_STALE" : "LIFECYCLE_OPERATION_UNAVAILABLE",
        "error",
        stale
          ? `The ${profile.displayName} lifecycle contract conflicts with current local evidence.`
          : `${action} is unavailable for ${profile.displayName}/${surface.surfaceId}.`,
      )],
    };
  }
  if (operation.disposition === "not-applicable") {
    if (action === "install" && surface.distributionKind === "bundled") {
      return {
        state: "noop",
        notes: ["Better Harness is bundled with this host; no separate install is applicable."],
      };
    }
    return {
      state: "blocked",
      blockers: [diagnostic(
        "LIFECYCLE_OPERATION_NOT_APPLICABLE",
        "warning",
        `${action} is not applicable to ${profile.displayName}/${surface.surfaceId}.`,
      )],
    };
  }
  const hostBlockers = preflightBlockers.filter((item) => item.code === "HOST_EXECUTABLE_NOT_FOUND");
  if (hostBlockers.length > 0) {
    return {
      state: "blocked",
      blockers: hostBlockers,
    };
  }
  const installed = installation === "installed";
  const absent = installation === "not-installed";
  if (action === "install" && installed) {
    return {
      state: "noop",
      notes: ["Better Harness is already installed at the selected target; install does not imply update."],
    };
  }
  if (action === "update" && absent) {
    return {
      state: "blocked",
      blockers: [diagnostic(
        "PLUGIN_NOT_INSTALLED",
        "error",
        "Better Harness is not installed at the selected target; update will not become a first install.",
      )],
    };
  }
  if (action === "remove" && absent) {
    return {
      state: "noop",
      notes: ["Better Harness is not installed at the selected target; nothing would be removed."],
    };
  }
  if (installation === "unknown" && operation.disposition !== "manual") {
    return {
      state: "blocked",
      blockers: [diagnostic(
        "INSTALLATION_STATE_UNOBSERVED",
        "error",
        `The available local evidence cannot prove whether Better Harness is installed for ${profile.displayName}/${surface.surfaceId}.`,
      )],
    };
  }
  if (
    !stepsCanBindHostHome(operation.steps, surface, hostHome)
    || !stepsCanBindHostHome(surface.lifecycle.verify.steps ?? [], surface, hostHome)
  ) {
    return {
      state: "blocked",
      blockers: [diagnostic(
        "ISOLATED_HOST_HOME_UNREPRESENTABLE",
        "error",
        `${profile.displayName}/${surface.surfaceId} cannot bind every native operation and verification step to the isolated host home.`,
      )],
    };
  }
  return {
    state: operation.disposition === "manual" ? "manual" : "ready",
    steps: operation.steps,
    notes: operation.disposition === "manual"
      ? ["This host operation requires an explicit native UI, session, or manually verified command path."]
      : [],
  };
}

export function createPluginLifecyclePlan({ action, profile, surface, scope, workspace, hostHome, observed }) {
  const rows = targetRows(observed, surface, scope);
  const target = {
    hostId: profile.hostId,
    surfaceId: surface.surfaceId,
    scope,
    distributionKind: surface.distributionKind,
    ...(["project", "local"].includes(scope) ? { workspace } : {}),
    ...(hostHome ? { hostHome } : {}),
    expectedSource: {
      pluginId: profile.identity.nativeIds[0],
      repository: "QoderAI/better-harness",
    },
  };
  const transition = transitionFor({
    action,
    profile,
    surface,
    installation: installationState(rows),
    hostHome,
    preflightBlockers: observationBlockers({ action, profile, surface, scope, observed }),
  });
  const state = transition.state;
  const blockers = transition.blockers ?? [];
  const notes = transition.notes ?? [];
  const steps = (transition.steps ?? [])
    .map((step, index) => materializeStep(step, surface, scope, workspace, hostHome, index, "mutation"));
  const rawVerificationSteps = surface.lifecycle.verify.steps ?? [];
  const verificationSteps = stepsCanBindHostHome(rawVerificationSteps, surface, hostHome)
    ? rawVerificationSteps.map((step, index) => (
        materializeStep(step, surface, scope, workspace, hostHome, index, "verification")
      ))
    : [];
  const planCore = {
    kind: "better-harness-plugin-plan",
    schemaVersion: PLUGIN_LIFECYCLE_SCHEMA_VERSION,
    plugin: observed.plugin,
    action,
    target,
    state,
    preconditionDigest: stableDigest({ target, observed: rows }),
    currentObservation: {
      instances: rows.length,
      installations: rows.map((row) => row.installation),
      verification: rows.map((row) => row.verification),
    },
    observed: rows,
    steps,
    verificationSteps,
    blockers,
    notes,
    retention: [...RETENTION_BOUNDARIES],
    activation: {
      newSessionRequired: ["ready", "manual"].includes(state),
      instruction: action === "remove"
        ? "Start a new host session before confirming that Better Harness is no longer routed."
        : "Start a new host session after external steps, then run plugin verify.",
    },
    recovery: [...RECOVERY_STEPS],
    effects: "none",
  };
  const plan = {
    ...planCore,
    planId: stableDigest(planCore),
    status: state === "blocked" ? "failed" : (state === "manual" ? "partial" : "ok"),
    diagnostics: blockers,
  };
  validatePluginLifecyclePlan(plan);
  return plan;
}
