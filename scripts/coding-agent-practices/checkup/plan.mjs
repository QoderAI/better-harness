import { CHECKUP_KIND, CHECKUP_SCHEMA_VERSION, digest, shortHash } from "./contract.mjs";

function findAsset(scan, finding) {
  if (finding.targetAssetId) {
    return scan.configuredInventory.assets.find((asset) => asset.id === finding.targetAssetId);
  }
  const id = finding.id.replace(/^finding-/u, "");
  return scan.configuredInventory.assets.find((asset) => shortHash(asset.id) === id);
}

function sourceRefKey(sourceRef) {
  return sourceRef ? `${sourceRef.base}:${sourceRef.relativePath}` : null;
}

function scopeForSkill(scope) {
  return scope === "project" ? "workspace" : "user";
}

function scopeForPlugin(scope) {
  return scope === "project" ? "project" : "user";
}

function qoderMutation(asset) {
  if (asset.kind === "skill") {
    return {
      type: "qoder-cli",
      executable: "qodercli",
      argv: ["skills", "disable", asset.name, "--scope", scopeForSkill(asset.scope)],
    };
  }
  if (asset.kind === "mcp") {
    return { type: "qoder-cli", executable: "qodercli", argv: ["mcp", "disable", asset.name] };
  }
  if (asset.kind === "plugin") {
    return {
      type: "qoder-cli",
      executable: "qodercli",
      argv: ["plugin", "disable", asset.pluginId ?? asset.name, "--scope", scopeForPlugin(asset.scope)],
    };
  }
  return { type: "manual-review", executable: null, argv: [] };
}

function inverseMutation(mutation) {
  if (mutation.type !== "qoder-cli") return mutation;
  return {
    ...mutation,
    argv: mutation.argv.map((part) => (part === "disable" ? "enable" : part)),
  };
}

function buildAction(scan, finding) {
  const asset = findAsset(scan, finding);
  if (!asset) return null;
  const duplicateHook = finding.evidence?.some((item) => item.code === "hook-duplicate-registration");
  const fingerprintKey = sourceRefKey(asset.sourceRef);
  const fingerprint = fingerprintKey ? scan.configuredInventory.sourceFingerprints?.[fingerprintKey] : null;
  const mutation = duplicateHook && asset.sourceRef && fingerprint
    ? {
        type: "source-patch",
        sourceRef: asset.sourceRef,
        patch: {
          type: "remove-hook-registration",
          event: asset.event,
          registrationIndex: asset.registrationIndex,
          hookIndex: asset.hookIndex,
          expectedConfigurationDigest: asset.configurationDigest,
        },
      }
    : qoderMutation(asset);
  const actionId = finding.candidateActions[0] ?? `disable-${asset.kind}-${shortHash(asset.id)}`;
  return {
    id: actionId,
    operation: duplicateHook ? "deduplicate" : asset.kind === "hook" ? "manual-review" : "disable",
    target: {
      id: asset.id,
      kind: asset.kind,
      name: asset.name,
      scope: asset.scope,
      ownerId: asset.ownerId,
    },
    reason: duplicateHook
      ? "An identical later hook registration has the same private full-config digest and owning source; remove only that duplicate."
      : asset.kind === "hook"
      ? "Attributed runtime evidence crossed the hook review budget; inspect matcher, duplication, blocking need, and command work before any confirmed source patch."
      : "No mapped use was observed in a complete all-eligible, scope-appropriate window outside the install grace period.",
    evidenceStatus: finding.status,
    expectedReduction: {
      configuredAssets: 1,
      tools: Number(asset.toolCount ?? 0),
      resources: Number(asset.resourceCount ?? 0),
      providedAssets: Number(asset.providedAssetCount ?? 0),
      tokenSavings: "estimate-not-available",
    },
    mutation,
    validation: [
      { type: "re-inventory", provider: scan.provider, targetId: asset.id },
      { type: "runtime-reload", state: "may-require-new-session" },
    ],
    rollback: mutation.type === "source-patch"
      ? [{ type: "restore-backup", sourceRef: mutation.sourceRef }]
      : [inverseMutation(mutation)],
    sourceFingerprints: fingerprintKey && fingerprint
      ? { [fingerprintKey]: fingerprint }
      : {
          state: "inventory-fingerprint-only",
          inventory: scan.diagnostics.scanDigest,
        },
  };
}

export function buildCheckupPlan(scan) {
  if (scan?.kind !== CHECKUP_KIND || scan?.phase !== "scan") {
    throw new Error("checkup plan requires a phase=scan checkup payload");
  }
  const actions = scan.findings
    .filter((finding) => finding.status === "candidate")
    .map((finding) => buildAction(scan, finding))
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
  const planCore = {
    provider: scan.provider,
    workspace: scan.workspace,
    observationWindow: scan.observationWindow,
    scanDigest: scan.diagnostics.scanDigest,
    repeatedFrictionTriage: scan.repeatedFrictionTriage ?? null,
    actions,
  };
  return {
    kind: CHECKUP_KIND,
    schemaVersion: CHECKUP_SCHEMA_VERSION,
    phase: "plan",
    provider: scan.provider,
    workspace: scan.workspace,
    observationWindow: scan.observationWindow,
    scanDigest: scan.diagnostics.scanDigest,
    repeatedFrictionTriage: scan.repeatedFrictionTriage ?? null,
    coverage: scan.coverage,
    summary: scan.summary,
    findings: scan.findings,
    actions,
    planDigest: digest(planCore),
    confirmation: {
      requiredForApply: true,
      selectedActionIdsRequired: true,
      applyAvailable: true,
      reason: "apply requires this plan digest, explicit selected action ids, and current source evidence",
    },
  };
}

export function computePlanDigest(plan) {
  return digest({
    provider: plan.provider,
    workspace: plan.workspace,
    observationWindow: plan.observationWindow,
    scanDigest: plan.scanDigest ?? plan.actions?.[0]?.sourceFingerprints?.inventory ?? null,
    repeatedFrictionTriage: plan.repeatedFrictionTriage ?? null,
    actions: plan.actions ?? [],
  });
}
