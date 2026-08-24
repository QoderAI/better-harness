import {
  findCapability,
  type CapabilityIr,
  type HarnessIrBundle,
  type HarnessMaterializationReceipt,
  type HarnessRevision,
} from "../ir/index.js";
import {
  assertRevisionAdapter,
  validateRevisionAgainstBundle,
} from "../ir/revision.js";
import type { AdapterRealizationDescriptor } from "../resolver/adapter-descriptor.js";
import {
  MAX_DELIVERED_SKILL_BYTES,
  type SkillDelivery,
  type SkillDeliveryMap,
} from "./skill-delivery.js";

export interface HarnessRunTask {
  prompt: string;
  cwd?: string;
  /** Root used to create revision source locks; intentionally independent from cwd. */
  sourceRoot?: string;
  /** Optional host-neutral cancellation signal for an in-flight turn. */
  abortSignal?: AbortSignal;
}

export interface HarnessRunResult {
  host: string;
  revisionId: string;
  exitCode: number;
  output: string;
  errorOutput: string;
  /** Realizations the executor could not materialize on this host. */
  warnings: string[];
  /** Redacted protocol events retained as run evidence when the host exposes them. */
  trace?: unknown[];
  /** Non-secret options the executor actually passed to the host runtime. */
  runtimeReceipt?: HarnessRuntimeReceipt;
  /** What the adapter materialized for this revision: per-capability observed facts. */
  materialization?: HarnessMaterializationReceipt;
  /** Host-reported consumption and termination evidence. */
  metrics?: HarnessRunMetrics;
}

export interface HarnessRuntimeReceipt {
  executor: string;
  runtimeProfile?: string;
  tools: string[];
  allowedTools: string[];
  disallowedTools: string[];
  permissionMode?: string;
  maxTurns?: number;
  persistSession?: boolean;
  model?: string;
  fileCheckpointing?: boolean;
  partialMessages?: boolean;
  permissionCallback: "configured" | "none";
  systemPromptSource?: "runtime-default" | "executor-profile";
  settingSources?: string[] | "runtime-default";
  skills?: string[] | "all" | "runtime-default";
  extensionCount?: number;
  pluginCount?: number;
  mcpServerNames?: string[];
  strictMcpConfig?: boolean;
}

export interface HarnessRunMetrics {
  durationMs?: number;
  durationApiMs?: number;
  turns?: number;
  costUsd?: number;
  credits?: number;
  usage?: Record<string, unknown>;
  modelUsage?: Record<string, unknown>;
  permissionDenials?: unknown[];
  sessionId?: string;
  stopReason?: string;
  terminalReason?: string;
}

export interface HarnessExecutor {
  readonly host: string;
  execute(revision: HarnessRevision, bundle: HarnessIrBundle, task: HarnessRunTask): Promise<HarnessRunResult>;
}

export interface RunPreamble {
  preamble: string;
  warnings: string[];
}

export class HarnessHostMismatchError extends Error {
  constructor(revisionRuntime: string, executorHost: string) {
    super(
      `Harness revision targets runtime '${revisionRuntime}', but executor host is '${executorHost}'.`,
    );
    this.name = "HarnessHostMismatchError";
  }
}

export function assertRevisionHost(revision: HarnessRevision, executorHost: string): void {
  if (revision.target.runtime !== executorHost) {
    throw new HarnessHostMismatchError(revision.target.runtime, executorHost);
  }
}

/**
 * Everything an adapter must verify before it loads a host SDK.
 *
 * Host and adapter identity come first because they are the cheapest rejections
 * and must not depend on an installed SDK. Bundle validation comes next: the
 * revision's content hashes are only a guarantee if somebody recomputes them
 * against the bundle the run will actually read.
 */
export function preflightRevision(
  revision: HarnessRevision,
  bundle: HarnessIrBundle,
  executorHost: string,
  descriptor: AdapterRealizationDescriptor,
): void {
  assertRevisionHost(revision, executorHost);
  assertRevisionAdapter(revision, descriptor);
  validateRevisionAgainstBundle(revision, bundle);
}

/** One prompt line per capability, in the voice of the agent role. */
function capabilityGuidance(
  capability: CapabilityIr | undefined,
  capabilityId: string,
  mechanism: string | null,
  deliveries: SkillDeliveryMap,
): string {
  const hostTool = mechanism?.startsWith("host-tool:") === true
    ? mechanism.slice("host-tool:".length)
    : undefined;
  if (capability === undefined) {
    return `Apply the '${capabilityId}' capability.`;
  }
  switch (capability.kind) {
    case "skill": {
      const delivered = deliveries.has(capability.id);
      if (capability.description !== undefined) {
        return delivered
          ? `${capability.description} (full skill text below.)`
          : capability.description;
      }
      // A source-backed skill with no inline description says what it is only in
      // its delivered body, so the bullet points at that section instead of
      // repeating a path the model cannot open.
      return delivered
        ? `Apply the '${capability.id}' skill, delivered in full below.`
        : `Apply the '${capability.id}' skill.`;
    }
    case "tool":
      return hostTool === undefined
        ? capability.description ?? `Use the '${capability.id}' tool when applicable.`
        : `Capability '${capability.id}' is the host tool '${hostTool}'` +
          (capability.description ? `: ${capability.description}` : ".");
    case "mcp":
      return `Connect to the '${capability.id}' MCP server over ${capability.transport}.`;
  }
}

/**
 * Build the prompt-facing portion of a run from a resolved revision.
 *
 * Guidance is not the same as materialization: a skill line genuinely delivers
 * the skill, while a tool line only names a host tool the adapter separately
 * exposed. Warnings come from the materialization receipt when the adapter
 * produced one, so the run result reports observed facts rather than a
 * re-derivation of the resolver's intent.
 */
export function buildRunPreamble(
  revision: HarnessRevision,
  bundle: HarnessIrBundle,
  receipt?: HarnessMaterializationReceipt,
  deliveries: SkillDeliveryMap = new Map(),
): RunPreamble {
  const lines: string[] = [];
  const warnings: string[] = [...(receipt?.warnings ?? [])];
  const deliveredSections = new Set<string>();
  const sections: string[] = [];
  for (const realization of revision.realization) {
    if (realization.state === "failed") {
      continue;
    }
    const capability = findCapability(bundle, realization.capabilityId);
    lines.push(
      `- [${realization.agentId}/${realization.capabilityId}] ` +
        capabilityGuidance(
          capability,
          realization.capabilityId,
          realization.mechanism,
          deliveries,
        ),
    );
    // Several agent roles may require the same skill; its text is delivered once.
    const delivery = deliveries.get(realization.capabilityId);
    if (delivery !== undefined && !deliveredSections.has(delivery.capabilityId)) {
      deliveredSections.add(delivery.capabilityId);
      sections.push(renderSkillSection(delivery));
      if (delivery.truncated) {
        warnings.push(
          `Skill '${delivery.capabilityId}' was truncated to ${MAX_DELIVERED_SKILL_BYTES} of ` +
            `${delivery.originalBytes} bytes when delivered into the run preamble.`,
        );
      }
    }
    // A source-backed skill is not delivered by naming its path in a prompt.
    if (
      delivery === undefined &&
      capability?.kind === "skill" &&
      capability.source !== undefined &&
      !deliveredSections.has(capability.id)
    ) {
      deliveredSections.add(capability.id);
      warnings.push(
        `Skill '${capability.id}' declares source '${capability.source}' but no content was ` +
          "delivered into this run; call loadSkillDeliveries() with the revision's source root.",
      );
    }
  }
  const preamble =
    lines.length > 0
      ? [
          `You are running under harness revision ${revision.revisionId}.`,
          "Follow these harness policies:",
          ...lines,
          ...sections,
        ].join("\n")
      : "";
  return { preamble, warnings };
}

/** Inline one delivered skill body, plus the files it can progressively disclose. */
function renderSkillSection(delivery: SkillDelivery): string {
  const parts = [`\n## Skill: ${delivery.capabilityId}\n`, delivery.body.trimEnd()];
  if (delivery.truncated) {
    parts.push(
      `\n[Truncated at ${MAX_DELIVERED_SKILL_BYTES} bytes of ${delivery.originalBytes}.]`,
    );
  }
  if (delivery.references.length > 0) {
    parts.push(
      `\nFurther files under '${delivery.source}': ${delivery.references.join(", ")}.`,
    );
  }
  return parts.join("\n");
}

export function buildRunPrompt(
  revision: HarnessRevision,
  bundle: HarnessIrBundle,
  task: HarnessRunTask,
  receipt?: HarnessMaterializationReceipt,
  deliveries: SkillDeliveryMap = new Map(),
): { prompt: string; warnings: string[] } {
  const { preamble, warnings } = buildRunPreamble(revision, bundle, receipt, deliveries);
  return {
    prompt: preamble.length > 0 ? `${preamble}\n\n${task.prompt}` : task.prompt,
    warnings,
  };
}
