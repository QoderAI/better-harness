import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  validateSessionExecutionPlan,
  type SessionExecutionPlan,
} from "@qoder-ai/harness/session-executor";
import type { CheckpointSourcePreview } from "../../experiment-setup.js";

export async function loadCheckpointSourcePreview(input: {
  planPath: string;
  expectedDigest: string;
  materializationCount: number;
}): Promise<CheckpointSourcePreview> {
  try {
    const bytes = await readFile(input.planPath);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== input.expectedDigest) {
      throw new Error(`checkpoint digest mismatch (${short(input.expectedDigest)} expected, ${short(digest)} read)`);
    }
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!isSessionExecutionPlan(parsed)) {
      throw new Error("no installed source adapter accepts this checkpoint plan");
    }
    const { plan } = await validateSessionExecutionPlan(parsed, { allowExistingOutputRef: true });
    return projectSessionExecutionCheckpoint(plan, input.materializationCount);
  } catch (error) {
    return unavailableCheckpointPreview(
      basename(input.planPath),
      input.expectedDigest,
      input.materializationCount,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function projectSessionExecutionCheckpoint(
  plan: SessionExecutionPlan,
  materializationCount: number,
): CheckpointSourcePreview {
  return {
    status: "ready",
    adapter: { id: "session-execution-plan-v1", label: "Versioned project + agent session" },
    resource: {
      label: "Repository",
      value: basename(plan.workspace.root),
      detail: "Versioned project resource",
    },
    revision: {
      label: "Commit",
      value: short(plan.workspace.baseCommit),
      detail: `tree ${short(plan.workspace.baseTree)}`,
    },
    history: {
      label: "Session position",
      value: `${short(plan.checkpoint.sessionId)} · ${short(plan.checkpoint.entryId)}`,
      detail: `${plan.provider} session · ${plan.checkpoint.entryCount} entries`,
    },
    materialization: {
      label: "Detached worktree",
      value: `${materializationCount} isolated ${materializationCount === 1 ? "copy" : "copies"}`,
      detail: "Created per fresh trial only after Run",
      timing: "on-run",
      count: materializationCount,
    },
    capabilities: {
      isolatedMaterialization: true,
      observedHistory: true,
      preserveResult: true,
    },
  };
}

function unavailableCheckpointPreview(
  planName: string,
  digest: string,
  materializationCount: number,
  limitation: string,
): CheckpointSourcePreview {
  return {
    status: "unavailable",
    adapter: { id: "unresolved", label: "Checkpoint adapter unavailable" },
    resource: { label: "Checkpoint", value: planName },
    revision: { label: "Digest", value: short(digest) },
    materialization: {
      label: "Isolated materialization",
      value: `${materializationCount} planned`,
      detail: "Blocked until a source adapter validates the checkpoint",
      timing: "on-run",
      count: materializationCount,
    },
    capabilities: {
      isolatedMaterialization: false,
      observedHistory: false,
      preserveResult: false,
    },
    limitation,
  };
}

function isSessionExecutionPlan(value: unknown): value is SessionExecutionPlan {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as { schemaVersion?: unknown }).schemaVersion === "session-execution-plan-v1"
    && "workspace" in value
    && "checkpoint" in value;
}

function short(value: string): string {
  const normalized = value.startsWith("sha256:") ? value.slice(7) : value;
  return normalized.length > 12 ? normalized.slice(0, 12) : normalized;
}
