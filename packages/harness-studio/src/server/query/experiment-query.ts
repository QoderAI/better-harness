import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  deriveContrastAttribution,
  evaluateObservedLane,
  isObservedLane,
  loadHarnessExperimentManifest,
} from "@qoder-ai/harness/experiment";
import {
  countLaneMaterializations,
  deriveCompareScenario,
  deriveRequestProvenance,
  type CheckpointSourcePreview,
  type ExperimentLockReceipt,
} from "../../experiment-setup.js";
import { projectObservedCalls } from "../experiment-events.js";
import { loadCheckpointSourcePreview } from "./checkpoint-source.js";
import { ObservedCallIndex, type ObservedCallPage } from "./observed-call-index.js";

/**
 * Read-only composition of one experiment manifest into the browser-facing
 * preview. Every call re-reads the manifest, prompt, and checkpoint plan from
 * disk; only the observed-call trajectories are indexed across calls (via
 * `observedIndexes`), since those are the only inputs large enough to matter.
 */
export async function buildExperimentPreview(input: {
  manifestPath: string;
  trajectoryOverrides?: Record<string, string>;
  checkpointSourcePreview?: CheckpointSourcePreview;
  lockReceipt?: ExperimentLockReceipt;
  observedIndexes: Map<string, ObservedCallIndex>;
}): Promise<Record<string, unknown>> {
  const loaded = await loadHarnessExperimentManifest(input.manifestPath);
  const observedCalls: Record<string, ReturnType<typeof projectObservedCalls>> = {};
  const observedCallPages: Record<string, { nextCursor?: string; complete: boolean; parsedLines: number; malformedLines: number }> = {};
  for (const [laneId, trajectory] of Object.entries({
    ...loaded.resolved.trajectories,
    ...input.trajectoryOverrides,
  })) {
    const page: ObservedCallPage = await observedIndex(input.observedIndexes, trajectory, laneId).page(undefined, 100).catch(() => ({ calls: [], complete: true, parsedLines: 0, malformedLines: 0 }));
    observedCalls[laneId] = page.calls;
    observedCallPages[laneId] = {
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      complete: page.complete,
      parsedLines: page.parsedLines,
      malformedLines: page.malformedLines,
    };
  }
  const prompt = await readFile(loaded.resolved.prompt);
  const promptText = prompt.toString("utf8");
  const promptHash = `sha256:${createHash("sha256").update(prompt).digest("hex")}`;
  const materializationCount = countLaneMaterializations(loaded.value.lanes);
  const checkpointSource = input.checkpointSourcePreview ?? await loadCheckpointSourcePreview({
    planPath: loaded.resolved.checkpointPlan,
    expectedDigest: loaded.value.checkpointRef.digest,
    materializationCount,
  });
  const attributionContext = {
    taskPromptHash: promptHash,
    completeness: { kind: "unverified" as const, reason: "preflight runs when the experiment starts" },
  };
  const requestProvenance = deriveRequestProvenance(loaded.value.lanes, promptHash);
  return {
    manifest: loaded.value,
    checkpoint: {
      digest: loaded.value.checkpointRef.digest,
      plan: loaded.value.checkpointRef.plan,
    },
    contrasts: loaded.value.contrasts.map((contrast) => ({
      id: contrast.id,
      lanes: contrast.lanes,
      attribution: deriveContrastAttribution(loaded.value, contrast, attributionContext),
    })),
    setup: {
      scenario: deriveCompareScenario(loaded.value.lanes),
      checkpointSource,
      request: {
        label: requestProvenance === "new" ? "New request" : "Imported request",
        prompt: promptText,
        promptHash,
        provenance: requestProvenance,
        ...(requestProvenance === "unverified-history"
          ? { limitation: "The loaded request is not proven to be the exact request that produced the observed history." }
          : {}),
      },
      historicalGaps: loaded.value.lanes
        .filter(isObservedLane)
        .map((lane) => evaluateObservedLane(lane, attributionContext))
        .filter((eligibility) => !eligibility.matched)
        .map(({ laneId, missing }) => ({ laneId, missing })),
    },
    observedCalls,
    observedCallPages,
    ...(input.lockReceipt === undefined ? {} : { lock: input.lockReceipt }),
  };
}

/** One page of a lane's observed tool calls, indexed incrementally by `laneId` + trajectory path. */
export async function readObservedCallsPage(input: {
  manifestPath: string;
  trajectoryOverrides?: Record<string, string>;
  observedIndexes: Map<string, ObservedCallIndex>;
  laneId: string;
  cursor?: string;
  limit: number;
}): Promise<ObservedCallPage> {
  const loaded = await loadHarnessExperimentManifest(input.manifestPath);
  const trajectory = input.trajectoryOverrides?.[input.laneId] ?? loaded.resolved.trajectories[input.laneId];
  if (trajectory === undefined) throw new Error(`Lane '${input.laneId}' has no observed trajectory.`);
  return observedIndex(input.observedIndexes, trajectory, input.laneId).page(input.cursor, input.limit);
}

export function observedIndex(indexes: Map<string, ObservedCallIndex>, path: string, laneId: string): ObservedCallIndex {
  const key = `${laneId}\0${path}`;
  let index = indexes.get(key);
  if (index === undefined) {
    index = new ObservedCallIndex(path, laneId);
    indexes.set(key, index);
  }
  return index;
}
