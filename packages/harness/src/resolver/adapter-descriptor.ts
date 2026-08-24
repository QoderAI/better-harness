/** Adapter-owned realization facts for Harness DSL v0.3. */
import type {
  CapabilityIr,
  McpIr,
  RealizationDimension,
  WorkflowIr,
} from "../ir/index.js";
import { contentEquals } from "../ir/canonical.js";

export interface AdapterSkillDelivery {
  mechanism: string;
}

export interface AdapterToolExposure {
  hostTool: string;
  contract: string;
}

export interface AdapterMcpSupport {
  mechanism: string;
  transports: readonly McpIr["transport"][];
}

export interface AdapterRealizationDescriptor {
  adapterId: string;
  specificationVersion: string;
  implementationVersion: string;
  skillDelivery: AdapterSkillDelivery | null;
  /** DSL tool id -> exact portable contract plus host-native tool handle. */
  toolExposure: Readonly<Record<string, AdapterToolExposure>>;
  mcpSupport: AdapterMcpSupport | null;
  workflowModes: readonly WorkflowIr["mode"][];
  programmaticLanguages: readonly string[];
}

/** Honest floor: one prompt session with delivered guidance and no callable surface. */
export const PROMPT_ONLY_DESCRIPTOR: AdapterRealizationDescriptor = Object.freeze({
  adapterId: "@harness/adapter-unknown",
  specificationVersion: "harness-adapter-v1",
  implementationVersion: "unresolved",
  skillDelivery: Object.freeze({ mechanism: "prompt-preamble" }),
  toolExposure: Object.freeze({}),
  mcpSupport: null,
  workflowModes: Object.freeze(["session" as const]),
  programmaticLanguages: Object.freeze([]),
});

export function describeAdapter(
  overrides: Partial<AdapterRealizationDescriptor> & Pick<AdapterRealizationDescriptor, "adapterId">,
): AdapterRealizationDescriptor {
  const descriptor = { ...PROMPT_ONLY_DESCRIPTOR, ...overrides };
  return Object.freeze({
    ...descriptor,
    skillDelivery: descriptor.skillDelivery === null
      ? null
      : Object.freeze({ ...descriptor.skillDelivery }),
    toolExposure: Object.freeze(Object.fromEntries(
      Object.entries(descriptor.toolExposure).map(([id, exposure]) => [
        id,
        Object.freeze({ ...exposure }),
      ]),
    )),
    mcpSupport: descriptor.mcpSupport === null
      ? null
      : Object.freeze({
          ...descriptor.mcpSupport,
          transports: Object.freeze([...descriptor.mcpSupport.transports]),
        }),
    workflowModes: Object.freeze([...descriptor.workflowModes]),
    programmaticLanguages: Object.freeze([...descriptor.programmaticLanguages]),
  });
}

export function descriptorsEqual(
  a: AdapterRealizationDescriptor,
  b: AdapterRealizationDescriptor,
): boolean {
  return contentEquals(a, b);
}

export interface CapabilityRealizationFact {
  available: boolean;
  mechanism: string | null;
  dimension: Exclude<RealizationDimension, "orchestrated">;
  limitation?: string;
}

export function realizationFactFor(
  descriptor: AdapterRealizationDescriptor,
  capability: CapabilityIr,
): CapabilityRealizationFact {
  switch (capability.kind) {
    case "skill":
      return descriptor.skillDelivery === null
        ? {
            available: false,
            mechanism: null,
            dimension: "delivered",
            limitation: `adapter '${descriptor.adapterId}' delivers no skill guidance`,
          }
        : {
            available: true,
            mechanism: descriptor.skillDelivery.mechanism,
            dimension: "delivered",
          };
    case "tool": {
      const exposure = descriptor.toolExposure[capability.id];
      if (exposure === undefined) {
        return {
          available: false,
          mechanism: null,
          dimension: "exposed",
          limitation:
            `adapter '${descriptor.adapterId}' exposes no host tool for '${capability.id}'; ` +
            "prompt guidance cannot satisfy a tool requirement",
        };
      }
      if (exposure.contract !== capability.contract) {
        return {
          available: false,
          mechanism: null,
          dimension: "exposed",
          limitation:
            `adapter '${descriptor.adapterId}' exposes '${capability.id}' with contract ` +
            `'${exposure.contract}', expected '${capability.contract}'`,
        };
      }
      return {
        available: true,
        mechanism: `host-tool:${exposure.hostTool}`,
        dimension: "exposed",
      };
    }
    case "mcp":
      return descriptor.mcpSupport === null
        ? {
            available: false,
            mechanism: null,
            dimension: "connected",
            limitation:
              `adapter '${descriptor.adapterId}' opens no MCP connection, so '${capability.id}' ` +
              "is never connected or tool-discovered",
          }
        : !descriptor.mcpSupport.transports.includes(capability.transport)
          ? {
              available: false,
              mechanism: null,
              dimension: "connected",
              limitation:
                `adapter '${descriptor.adapterId}' cannot connect MCP transport ` +
                `'${capability.transport}' for '${capability.id}'`,
            }
          : {
            available: true,
            mechanism: descriptor.mcpSupport.mechanism,
            dimension: "connected",
            };
  }
}

export interface WorkflowRealizationFact {
  mode: WorkflowIr["mode"] | null;
  supported: boolean;
  limitation?: string;
}

export function workflowFactFor(
  descriptor: AdapterRealizationDescriptor,
  workflow: WorkflowIr,
): WorkflowRealizationFact {
  if (!descriptor.workflowModes.includes(workflow.mode)) {
    const limitation = workflow.mode === "programmatic"
      ? `adapter '${descriptor.adapterId}' cannot execute programmatic controller ` +
        `'${workflow.program?.entry ?? "?"}'`
      : workflow.mode === "state-machine"
        ? `adapter '${descriptor.adapterId}' cannot orchestrate state-machine workflow '${workflow.id}'`
        : `adapter '${descriptor.adapterId}' cannot run a single-session workflow`;
    return { mode: null, supported: false, limitation };
  }
  return { mode: workflow.mode, supported: true };
}
