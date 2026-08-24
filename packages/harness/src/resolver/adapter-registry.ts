import { STANDARD_TOOL_CONTRACTS } from "../ir/index.js";
import { describeAdapter, type AdapterRealizationDescriptor } from "./adapter-descriptor.js";

function exposeStandardTool(id: string, hostTool: string) {
  const contract = STANDARD_TOOL_CONTRACTS[id];
  if (contract === undefined) {
    throw new Error(`Unknown standard tool contract '${id}'.`);
  }
  return Object.freeze({ hostTool, contract });
}

export const QODER_ADAPTER_DESCRIPTOR = describeAdapter({
  adapterId: "@harness/adapter-qoder",
  specificationVersion: "harness-adapter-v1",
  implementationVersion: "0.1.0",
  skillDelivery: { mechanism: "prompt-preamble" },
  toolExposure: Object.freeze({
    "workspace.read": exposeStandardTool("workspace.read", "Read"),
    "workspace.glob": exposeStandardTool("workspace.glob", "Glob"),
    "workspace.search": exposeStandardTool("workspace.search", "Grep"),
    "workspace.edit": exposeStandardTool("workspace.edit", "Edit"),
    "workspace.write": exposeStandardTool("workspace.write", "Write"),
    "process.exec": exposeStandardTool("process.exec", "Bash"),
  }),
  mcpSupport: null,
  workflowModes: Object.freeze(["session"]),
  programmaticLanguages: Object.freeze([]),
});

export const PI_ADAPTER_DESCRIPTOR = describeAdapter({
  adapterId: "@harness/adapter-pi",
  specificationVersion: "harness-adapter-v1",
  implementationVersion: "0.1.0",
  skillDelivery: { mechanism: "prompt-preamble" },
  toolExposure: Object.freeze({}),
  mcpSupport: null,
  workflowModes: Object.freeze(["session"]),
  programmaticLanguages: Object.freeze([]),
});

/**
 * ACP is a transport/session contract, not proof of any Agent-owned tool.
 * Keep the built-in descriptor at the honest prompt-session floor; a future
 * Agent-specific adapter may expose tools only from its own verified contract.
 */
export const ACP_ADAPTER_DESCRIPTOR = describeAdapter({
  adapterId: "@harness/adapter-acp",
  specificationVersion: "harness-adapter-v1",
  implementationVersion: "0.1.0",
  skillDelivery: { mechanism: "prompt-preamble" },
  toolExposure: Object.freeze({}),
  mcpSupport: null,
  workflowModes: Object.freeze(["session"]),
  programmaticLanguages: Object.freeze([]),
});

export const ADAPTER_DESCRIPTOR_REGISTRY: Readonly<Record<string, AdapterRealizationDescriptor>> =
  Object.freeze({
    [ACP_ADAPTER_DESCRIPTOR.adapterId]: ACP_ADAPTER_DESCRIPTOR,
    [QODER_ADAPTER_DESCRIPTOR.adapterId]: QODER_ADAPTER_DESCRIPTOR,
    [PI_ADAPTER_DESCRIPTOR.adapterId]: PI_ADAPTER_DESCRIPTOR,
  });

export function describeBuiltInAdapter(
  runtimeOrAdapterId: string,
): AdapterRealizationDescriptor | undefined {
  const adapterId = runtimeOrAdapterId.startsWith("@")
    ? runtimeOrAdapterId
    : `@harness/adapter-${runtimeOrAdapterId}`;
  return ADAPTER_DESCRIPTOR_REGISTRY[adapterId];
}
