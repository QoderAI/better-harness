/**
 * Load and validate a `harness-experiment.v1` manifest from disk.
 *
 * This is the Node half of the contract: the shape and its pure predicates live
 * in `contract.ts` so Studio's browser bundle can read lane configuration
 * without importing the filesystem. Everything that needs a real path — owned
 * path resolution, escape rejection, cross-field policy — stays here.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { Value } from "@sinclair/typebox/value";
import {
  HarnessExperimentManifestSchema,
  findLane,
  invalidExperimentManifest,
  isExecuteLane,
  isObservedLane,
  type HarnessExperimentManifest,
} from "./contract.js";

/** Host tools that reach the network and must be unavailable under a denied network. */
const NETWORK_TOOLS = ["WebFetch", "WebSearch"];
const REQUIRED_TOOLS = ["Read", "Edit", "Write", "Bash"];
const SUPPORTED_TOOLS = new Set(["Read", "Glob", "Grep", "Edit", "Write", "Bash"]);

export interface LoadedHarnessExperimentManifest {
  path: string;
  directory: string;
  value: HarnessExperimentManifest;
  resolved: {
    harness: string;
    checkpointPlan: string;
    prompt: string;
    graderContract: string;
    /** Absolute trajectory paths keyed by observed lane id. */
    trajectories: Record<string, string>;
  };
}

export async function loadHarnessExperimentManifest(
  path: string,
): Promise<LoadedHarnessExperimentManifest> {
  const manifestPath = resolve(path);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read harness experiment manifest '${path}': ${errorMessage(error)}`);
  }
  if (!Value.Check(HarnessExperimentManifestSchema, value)) {
    const details = [...Value.Errors(HarnessExperimentManifestSchema, value)]
      .slice(0, 8)
      .map((error) => `${error.path || "/"}: ${error.message}`)
      .join("; ");
    throw new Error(`Invalid harness-experiment.v1 manifest: ${details}`);
  }
  validateManifestPolicy(value);
  const directory = resolve(manifestPath, "..");
  const trajectories: Record<string, string> = {};
  for (const lane of value.lanes) {
    if (isObservedLane(lane)) {
      trajectories[lane.id] = resolveOwnedPath(directory, lane.trajectory, `lanes.${lane.id}.trajectory`);
    }
  }
  return {
    path: manifestPath,
    directory,
    value,
    resolved: {
      harness: resolveOwnedPath(directory, value.harness, "harness"),
      checkpointPlan: resolveOwnedPath(directory, value.checkpointRef.plan, "checkpointRef.plan"),
      prompt: resolveOwnedPath(directory, value.task.prompt, "task.prompt"),
      graderContract: resolveOwnedPath(directory, value.task.grader.contract, "task.grader.contract"),
      trajectories,
    },
  };
}

function validateManifestPolicy(manifest: HarnessExperimentManifest): void {
  const laneIds = new Set<string>();
  for (const lane of manifest.lanes) {
    if (laneIds.has(lane.id)) {
      throw invalidExperimentManifest(`duplicate lane id '${lane.id}'`);
    }
    laneIds.add(lane.id);
  }
  if (!manifest.lanes.some(isExecuteLane)) {
    throw invalidExperimentManifest(
      "at least one lane must have origin 'execute'; an experiment of only observed lanes " +
        "replays history and measures nothing",
    );
  }
  for (const lane of manifest.lanes) {
    if (
      isObservedLane(lane) &&
      lane.startCheckpointDigest !== undefined &&
      lane.startCheckpointDigest !== manifest.checkpointRef.digest
    ) {
      throw invalidExperimentManifest(
        `observed lane '${lane.id}' started from a different checkpoint than checkpointRef.digest; ` +
          "an observed trajectory from another checkpoint cannot share this experiment's start",
      );
    }
  }
  const contrastIds = new Set<string>();
  for (const contrast of manifest.contrasts) {
    if (contrastIds.has(contrast.id)) {
      throw invalidExperimentManifest(`duplicate contrast id '${contrast.id}'`);
    }
    contrastIds.add(contrast.id);
    for (const laneId of contrast.lanes) {
      if (!laneIds.has(laneId)) {
        throw invalidExperimentManifest(
          `contrast '${contrast.id}' references unknown lane '${laneId}'`,
        );
      }
    }
    const referenced = contrast.lanes.map((laneId) => findLane(manifest, laneId)!);
    if (referenced.every(isObservedLane)) {
      throw invalidExperimentManifest(
        `contrast '${contrast.id}' compares only observed lanes; it has nothing fresh to attribute to`,
      );
    }
  }
  validateRuntimePolicy(manifest.runtime);
  for (const path of [
    manifest.harness,
    manifest.checkpointRef.plan,
    manifest.task.prompt,
    manifest.task.grader.contract,
    ...manifest.task.expectedFiles,
    ...manifest.lanes.filter(isObservedLane).map((lane) => lane.trajectory),
  ]) {
    assertPortableRelativePath(path);
  }
}

/**
 * The shared run policy, checked once.
 *
 * These are the same guarantees `harness-compare.v1` enforces per variant. They
 * apply once here because the policy is shared, which is exactly why it is not a
 * lane field.
 */
function validateRuntimePolicy(runtime: HarnessExperimentManifest["runtime"]): void {
  const unsupportedTools = runtime.tools.filter((tool) => !SUPPORTED_TOOLS.has(tool));
  if (unsupportedTools.length > 0) {
    throw invalidExperimentManifest(
      `runtime has unsupported visible tools: ${unsupportedTools.join(", ")}`,
    );
  }
  for (const tool of REQUIRED_TOOLS) {
    if (!runtime.tools.includes(tool)) {
      throw invalidExperimentManifest(`runtime.tools must include '${tool}'`);
    }
  }
  if (runtime.allowedTools.length > 0) {
    throw invalidExperimentManifest(
      "allowedTools must be empty; every tool use requires the bounded permission callback",
    );
  }
  if (runtime.network === "deny") {
    for (const tool of NETWORK_TOOLS) {
      if (!runtime.disallowedTools.includes(tool)) {
        throw invalidExperimentManifest(
          `network 'deny' requires disallowedTools to include '${tool}'`,
        );
      }
    }
  }
  const unavailableRequiredTools = REQUIRED_TOOLS.filter((tool) =>
    runtime.disallowedTools.includes(tool),
  );
  if (unavailableRequiredTools.length > 0) {
    throw invalidExperimentManifest(
      `required tools are also disallowed: ${unavailableRequiredTools.join(", ")}`,
    );
  }
}

function resolveOwnedPath(base: string, relativePath: string, label: string): string {
  assertPortableRelativePath(relativePath);
  const result = resolve(base, relativePath);
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  if (result !== base && !result.startsWith(prefix)) {
    throw invalidExperimentManifest(`${label} escapes the manifest directory`);
  }
  return result;
}

function assertPortableRelativePath(value: string): void {
  if (
    isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw invalidExperimentManifest(`path '${value}' is not a portable relative path`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
