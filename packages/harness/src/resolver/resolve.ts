import { contentHash } from "../ir/canonical.js";
import {
  type CapabilityIr,
  type DeploymentIr,
  type HarnessIrBundle,
  type HarnessRevision,
  type HarnessSpecIr,
  IR_VERSION,
  type Realization,
  type ResolutionReport,
  type RuntimeIr,
  type SourceLock,
  type WorkflowIr,
  findCapability,
} from "../ir/index.js";
import { computeRevisionId, deepFreeze } from "../ir/revision.js";
import {
  PROMPT_ONLY_DESCRIPTOR,
  realizationFactFor,
  workflowFactFor,
  type AdapterRealizationDescriptor,
} from "./adapter-descriptor.js";

export interface ResolveOptions {
  /** Adapter facts for the runtime selected by the deployment. */
  adapter?:
    | AdapterRealizationDescriptor
    | ((runtimeId: string) => AdapterRealizationDescriptor | undefined);
  /** Content locks for source-backed skills, from `lockCapabilitySources`. */
  sourceLocks?: readonly SourceLock[];
  /** Provenance link included in the immutable revision hash. */
  componentSnapshotRef?: { snapshotId: string; digest: string };
}

export interface ResolveResult {
  revision?: HarnessRevision;
  report: ResolutionReport;
}

/** Resolve the unique deployment of a harness, optionally narrowed by runtime. */
export function resolveHarness(
  bundle: HarnessIrBundle,
  harnessId: string,
  runtimeId?: string,
  options: ResolveOptions = {},
): ResolveResult {
  const harness = bundle.harnesses.find((candidate) => candidate.id === harnessId);
  if (harness === undefined) {
    return {
      report: failedReport(harnessId, runtimeId ?? "unknown", [], [
        `Harness '${harnessId}' is not defined in the bundle.`,
      ]),
    };
  }

  const candidates = bundle.deployments.filter(
    (deployment) =>
      deployment.harness === harnessId &&
      (runtimeId === undefined || deployment.runtime === runtimeId),
  );
  if (candidates.length !== 1) {
    const message = candidates.length === 0
      ? `Harness '${harnessId}' has no declared deployment${runtimeId === undefined ? "" : ` on runtime '${runtimeId}'`}.`
      : `Harness '${harnessId}' has multiple deployments${runtimeId === undefined ? "" : ` on runtime '${runtimeId}'`}; resolve by deployment id.`;
    return {
      report: failedReport(harnessId, runtimeId ?? "unknown", [], [message]),
    };
  }
  return resolveSelectedDeployment(bundle, candidates[0], harness, options);
}

/** Resolve one named deployment. This is the unambiguous v0.3 entrypoint. */
export function resolveDeployment(
  bundle: HarnessIrBundle,
  deploymentId: string,
  options: ResolveOptions = {},
): ResolveResult {
  const deployment = bundle.deployments.find((candidate) => candidate.id === deploymentId);
  if (deployment === undefined) {
    return {
      report: failedReport("unknown", "unknown", [], [
        `Deployment '${deploymentId}' is not defined in the bundle.`,
      ], [], deploymentId),
    };
  }
  const harness = bundle.harnesses.find((candidate) => candidate.id === deployment.harness);
  if (harness === undefined) {
    return {
      report: failedReport(deployment.harness, deployment.runtime, [], [
        `Deployment '${deployment.id}' references unknown harness '${deployment.harness}'.`,
      ], [], deployment.id),
    };
  }
  return resolveSelectedDeployment(bundle, deployment, harness, options);
}

function resolveSelectedDeployment(
  bundle: HarnessIrBundle,
  deployment: DeploymentIr,
  harness: HarnessSpecIr,
  options: ResolveOptions,
): ResolveResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const runtime = bundle.runtimes.find((candidate) => candidate.id === deployment.runtime);
  if (runtime === undefined) {
    return {
      report: failedReport(harness.id, deployment.runtime, [], [
        `Deployment '${deployment.id}' references unknown runtime '${deployment.runtime}'.`,
      ], warnings, deployment.id),
    };
  }

  const descriptor = descriptorFor(options.adapter, runtime, errors);
  if (descriptor === undefined) {
    return {
      report: failedReport(harness.id, runtime.id, [], errors, warnings, deployment.id),
    };
  }

  const workflow = bundle.workflows.find((candidate) => candidate.id === harness.workflow);
  if (workflow === undefined) {
    return {
      report: failedReport(harness.id, runtime.id, [], [
        `Workflow '${harness.workflow}' is not defined in the bundle.`,
      ], warnings, deployment.id),
    };
  }
  checkWorkflowDeployability(workflow, runtime, descriptor, errors);

  const realizations: Realization[] = [];
  const enabledCapabilityIds = new Set<string>();
  for (const agent of harness.agents) {
    for (const requirement of agent.requirements) {
      const capability = findCapability(bundle, requirement.capabilityId);
      if (capability === undefined) {
        errors.push(
          `Agent '${agent.id}' requires unknown capability '${requirement.capabilityId}'.`,
        );
        continue;
      }
      enabledCapabilityIds.add(capability.id);
      const fact = realizationFactFor(descriptor, capability);
      const realization: Realization = {
        agentId: agent.id,
        capabilityId: capability.id,
        capabilityKind: capability.kind,
        dimension: fact.dimension,
        state: fact.available ? "satisfied" : "failed",
        mechanism: fact.mechanism,
        ...(fact.limitation === undefined ? {} : { reason: fact.limitation }),
      };
      realizations.push(realization);
      if (!fact.available) {
        errors.push(
          `Capability '${capability.id}' for agent '${agent.id}' is unavailable on runtime ` +
            `'${runtime.id}': ${fact.limitation ?? "the adapter exposes no matching contract"}.`,
        );
      }
    }
  }
  realizations.sort(
    (a, b) => compareByKey(a.agentId, b.agentId) || compareByKey(a.capabilityId, b.capabilityId),
  );
  if (errors.length > 0) {
    return {
      report: failedReport(harness.id, runtime.id, realizations, errors, warnings, deployment.id),
    };
  }

  const enabledCapabilities = [...enabledCapabilityIds]
    .sort(compareByKey)
    .map((id) => findCapability(bundle, id))
    .filter((capability): capability is CapabilityIr => capability !== undefined);
  const sourceLocks = selectSourceLocks(enabledCapabilities, options.sourceLocks ?? [], errors);
  if (errors.length > 0) {
    return {
      report: failedReport(harness.id, runtime.id, realizations, errors, warnings, deployment.id),
    };
  }

  const revisionBody: Omit<HarnessRevision, "revisionId"> = {
    irVersion: IR_VERSION,
    kind: "harness-revision",
    harness: { id: harness.id, contentHash: contentHash(harness) },
    deployment: { id: deployment.id, contentHash: contentHash(deployment) },
    target: {
      runtime: runtime.id,
      adapter: runtime.adapter,
      adapterSpecificationVersion: descriptor.specificationVersion,
      adapterImplementationVersion: descriptor.implementationVersion,
      adapterDescriptorHash: contentHash(descriptor),
    },
    workflow: { id: workflow.id, mode: workflow.mode, contentHash: contentHash(workflow) },
    resolved: {
      capabilities: enabledCapabilities.map((capability) => ({
        id: capability.id,
        kind: capability.kind,
        contentHash: contentHash(capability),
      })),
    },
    agents: harness.agents.map((agent) => ({
      id: agent.id,
      capabilities: agent.requirements
        .map((requirement) => requirement.capabilityId)
        .sort(compareByKey),
    })),
    realization: realizations,
    sourceLocks,
    ...(options.componentSnapshotRef === undefined
      ? {}
      : { componentSnapshotRef: { ...options.componentSnapshotRef } }),
  };
  const revision = deepFreeze<HarnessRevision>(
    structuredClone({ ...revisionBody, revisionId: computeRevisionId(revisionBody) }),
  );

  return {
    revision,
    report: {
      irVersion: IR_VERSION,
      kind: "resolution-report",
      harnessId: harness.id,
      deploymentId: deployment.id,
      runtime: runtime.id,
      status: "resolved",
      realizations,
      errors: [],
      warnings,
    },
  };
}

function descriptorFor(
  adapter: ResolveOptions["adapter"],
  runtime: RuntimeIr,
  errors: string[],
): AdapterRealizationDescriptor | undefined {
  const floor = { ...PROMPT_ONLY_DESCRIPTOR, adapterId: runtime.adapter };
  const supplied = adapter === undefined
    ? floor
    : typeof adapter === "function"
      ? adapter(runtime.id) ?? floor
      : adapter;
  if (supplied.adapterId !== runtime.adapter) {
    errors.push(
      `Runtime '${runtime.id}' selects adapter '${runtime.adapter}', but the supplied realization ` +
        `descriptor describes '${supplied.adapterId}'.`,
    );
    return undefined;
  }
  return supplied;
}

function checkWorkflowDeployability(
  workflow: WorkflowIr,
  runtime: RuntimeIr,
  descriptor: AdapterRealizationDescriptor,
  errors: string[],
): void {
  const fact = workflowFactFor(descriptor, workflow);
  if (!fact.supported) {
    errors.push(
      `Workflow '${workflow.id}' cannot run on runtime '${runtime.id}': ${fact.limitation}.`,
    );
    return;
  }
  if (
    workflow.mode === "programmatic" &&
    !descriptor.programmaticLanguages.includes(workflow.program?.language ?? "")
  ) {
    errors.push(
      `Workflow '${workflow.id}' uses programmatic language ` +
        `'${workflow.program?.language ?? "unknown"}', but adapter '${descriptor.adapterId}' ` +
        "does not declare that controller language.",
    );
  }
}

function selectSourceLocks(
  capabilities: readonly CapabilityIr[],
  supplied: readonly SourceLock[],
  errors: string[],
): SourceLock[] {
  const selected: SourceLock[] = [];
  for (const capability of capabilities) {
    if (capability.kind !== "skill" || capability.source === undefined) {
      continue;
    }
    const matches = supplied.filter((lock) => lock.capabilityId === capability.id);
    if (matches.length !== 1) {
      errors.push(
        `Source-backed skill '${capability.id}' requires exactly one content lock; ` +
          `received ${matches.length}. Run lockCapabilitySources() before resolving.`,
      );
      continue;
    }
    const lock = matches[0];
    if (lock.uri !== capability.source) {
      errors.push(
        `Source lock for skill '${capability.id}' names '${lock.uri}', expected '${capability.source}'.`,
      );
      continue;
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(lock.digest) || !Number.isInteger(lock.files) || lock.files < 1) {
      errors.push(`Source lock for skill '${capability.id}' has an invalid digest or file count.`);
      continue;
    }
    selected.push({ ...lock });
  }
  return selected.sort((a, b) => compareByKey(a.capabilityId, b.capabilityId));
}

function failedReport(
  harnessId: string,
  runtime: string,
  realizations: Realization[],
  errors: string[],
  warnings: string[] = [],
  deploymentId?: string,
): ResolutionReport {
  return {
    irVersion: IR_VERSION,
    kind: "resolution-report",
    harnessId,
    ...(deploymentId === undefined ? {} : { deploymentId }),
    runtime,
    status: "failed",
    realizations,
    errors,
    warnings,
  };
}

function compareByKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
