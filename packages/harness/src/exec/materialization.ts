/** Turn a resolved v0.3 revision into adapter-observed run facts. */
import {
  IR_VERSION,
  type CapabilityMaterialization,
  type HarnessIrBundle,
  type HarnessMaterializationReceipt,
  type HarnessRevision,
  type Realization,
  findCapability,
} from "../ir/index.js";
import {
  realizationFactFor,
  workflowFactFor,
  type AdapterRealizationDescriptor,
} from "../resolver/adapter-descriptor.js";
import { HarnessCapabilityUnsupportedError } from "./adapter.js";

/**
 * Recheck the exact capability contracts and workflow mode immediately before
 * starting the host. A revision resolved against a richer or different adapter
 * must fail closed here rather than silently becoming prompt guidance.
 */
export function prepareMaterialization(
  revision: HarnessRevision,
  bundle: HarnessIrBundle,
  descriptor: AdapterRealizationDescriptor,
): HarnessMaterializationReceipt {
  const capabilities: CapabilityMaterialization[] = [];
  for (const realization of onePerCapability(revision.realization)) {
    const capability = findCapability(bundle, realization.capabilityId);
    if (capability === undefined) {
      throw new HarnessCapabilityUnsupportedError(
        descriptor.adapterId,
        `${realization.capabilityKind}:${realization.capabilityId}`,
        `Capability '${realization.capabilityId}' is absent from the execution bundle.`,
      );
    }
    const fact = realizationFactFor(descriptor, capability);
    if (
      realization.state !== "satisfied" ||
      !fact.available ||
      fact.dimension !== realization.dimension ||
      fact.mechanism !== realization.mechanism ||
      fact.mechanism === null
    ) {
      throw new HarnessCapabilityUnsupportedError(
        descriptor.adapterId,
        `${realization.capabilityKind}:${realization.capabilityId}`,
        `Revision '${revision.revisionId}' records '${realization.capabilityId}' as ` +
          `satisfied via '${realization.mechanism ?? "none"}', but ` +
          `${fact.limitation ?? `this adapter reports '${fact.mechanism ?? "none"}'`}.`,
      );
    }
    capabilities.push({
      capabilityId: capability.id,
      capabilityKind: capability.kind,
      dimension: fact.dimension,
      state: "materialized",
      mechanism: fact.mechanism,
      ...(realization.reason === undefined ? {} : { detail: realization.reason }),
    });
  }

  const workflow = bundle.workflows.find((candidate) => candidate.id === revision.workflow.id);
  if (workflow === undefined) {
    throw new HarnessCapabilityUnsupportedError(
      descriptor.adapterId,
      "workflow-orchestration",
      `Workflow '${revision.workflow.id}' is absent from the execution bundle.`,
    );
  }
  const workflowFact = workflowFactFor(descriptor, workflow);
  if (!workflowFact.supported || workflowFact.mode === null) {
    throw new HarnessCapabilityUnsupportedError(
      descriptor.adapterId,
      "workflow-orchestration",
      `Workflow '${revision.workflow.id}' cannot run: ${workflowFact.limitation}.`,
    );
  }

  return {
    irVersion: IR_VERSION,
    kind: "materialization-receipt",
    revisionId: revision.revisionId,
    adapter: {
      id: descriptor.adapterId,
      specificationVersion: descriptor.specificationVersion,
    },
    capabilities,
    workflow: {
      id: workflow.id,
      dimension: "orchestrated",
      requestedMode: workflow.mode,
      realizedMode: workflowFact.mode,
      state: "materialized",
    },
    warnings: [],
  };
}

/** Host tool names the receipt proves this run exposes. */
export function exposedHostTools(receipt: HarnessMaterializationReceipt): string[] {
  const tools = receipt.capabilities
    .filter((capability) => capability.capabilityKind === "tool")
    .map((capability) => capability.mechanism)
    .filter((mechanism) => mechanism.startsWith("host-tool:"))
    .map((mechanism) => mechanism.slice("host-tool:".length));
  return [...new Set(tools)].sort();
}

function onePerCapability(realizations: readonly Realization[]): Realization[] {
  const byCapability = new Map<string, Realization>();
  for (const realization of realizations) {
    const current = byCapability.get(realization.capabilityId);
    if (current !== undefined && (
      current.capabilityKind !== realization.capabilityKind ||
      current.dimension !== realization.dimension ||
      current.state !== realization.state ||
      current.mechanism !== realization.mechanism
    )) {
      throw new Error(
        `Revision contains conflicting realizations for capability '${realization.capabilityId}'.`,
      );
    }
    byCapability.set(realization.capabilityId, realization);
  }
  return [...byCapability.values()].sort((a, b) =>
    a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0,
  );
}
