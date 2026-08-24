/**
 * The `harness-experiment.v1` shape and the pure predicates over it.
 *
 * This module is browser-safe on purpose. Studio renders lane configuration and
 * per-contrast attribution, so the schema, the lane types, and the lane
 * predicates must be reachable without pulling in the filesystem loader that
 * validates a manifest on disk (see `manifest.ts`).
 *
 * Two things are deliberately absent from the shape:
 *
 * - a checkpoint definition. The manifest carries only a `checkpointRef`, because
 *   `session-execution-plan-v1` already owns what a checkpoint is. Copying its
 *   fields here would create a second place to reinterpret them.
 * - a treatment axis. A contrast names lanes and nothing else; the axis is
 *   computed from how those lanes differ (see `axis.ts`). An author-declared
 *   axis would let a multi-axis comparison wear a single-axis label.
 */
import { Type, type Static } from "@sinclair/typebox";

const RelativePathSchema = Type.String({ minLength: 1, maxLength: 512 });
const IdentifierSchema = Type.String({ pattern: "^[_a-zA-Z][\\w-]*$" });
const Sha256Schema = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const QoderRuntimeProfileSchema = Type.Union([
  Type.Literal("qoder-default-v1"),
  Type.Literal("qoder-minimal-v1"),
]);

/**
 * A recorded trajectory. It creates no sandbox and is replayed, not run.
 *
 * `identity` is optional and deliberately partial: historical sessions rarely
 * retain every fact. What is missing decides whether this lane can be a matched
 * baseline or only context, so absence is recorded rather than assumed.
 */
const ObservedLaneSchema = Type.Object(
  {
    id: IdentifierSchema,
    origin: Type.Literal("observed"),
    trajectory: RelativePathSchema,
    /**
     * The checkpoint this trajectory started from, when the recorder retained it.
     * Absence is evidence too: imported history stays contextual instead of
     * borrowing the experiment checkpoint by implication.
     */
    startCheckpointDigest: Type.Optional(Sha256Schema),
    identity: Type.Optional(Type.Object(
      {
        harnessId: Type.Optional(IdentifierSchema),
        revisionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
        profile: Type.Optional(QoderRuntimeProfileSchema),
        model: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
        promptHash: Type.Optional(Sha256Schema),
        environmentReceipt: Type.Optional(RelativePathSchema),
      },
      { additionalProperties: false },
    )),
  },
  { additionalProperties: false },
);

/**
 * A lane executed fresh from the shared checkpoint.
 *
 * `trials` is required rather than defaulted: a lane that runs once is a smoke
 * test, and making the count explicit keeps that visible at authoring time
 * instead of surfacing later as an unexplained `insufficient_evidence`.
 */
const ExecuteLaneSchema = Type.Object(
  {
    id: IdentifierSchema,
    origin: Type.Literal("execute"),
    harnessId: IdentifierSchema,
    trials: Type.Integer({ minimum: 1, maximum: 20 }),
    runtime: Type.Object(
      {
        profile: QoderRuntimeProfileSchema,
        model: Type.String({ minLength: 1, maxLength: 128 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

/**
 * A comparison between lanes. It carries no axis and no mode.
 *
 * `additionalProperties: false` is the enforcement point for that rule: a
 * manifest that writes `"axis": "model"` is rejected rather than believed.
 */
const ContrastSchema = Type.Object(
  {
    id: IdentifierSchema,
    lanes: Type.Array(IdentifierSchema, { minItems: 2, maxItems: 6, uniqueItems: true }),
  },
  { additionalProperties: false },
);

export const HarnessExperimentManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal("harness-experiment.v1"),
    harness: RelativePathSchema,
    /** A reference, never a copy: the plan file remains the checkpoint definition. */
    checkpointRef: Type.Object(
      { plan: RelativePathSchema, digest: Sha256Schema },
      { additionalProperties: false },
    ),
    task: Type.Object(
      {
        prompt: RelativePathSchema,
        expectedFiles: Type.Array(RelativePathSchema, { minItems: 1, maxItems: 32, uniqueItems: true }),
        grader: Type.Object(
          { kind: Type.Literal("readme-package-v1"), contract: RelativePathSchema },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    /**
     * Shared execution policy. Host and visible tools live here, not on a lane,
     * so a lane cannot move the host and confound every contrast at once.
     */
    runtime: Type.Object(
      {
        host: Type.Literal("qoder"),
        tools: Type.Array(Type.String(), { minItems: 1, maxItems: 32, uniqueItems: true }),
        allowedTools: Type.Array(Type.String(), { maxItems: 32, uniqueItems: true }),
        disallowedTools: Type.Array(Type.String(), { maxItems: 32, uniqueItems: true }),
        permissionMode: Type.Literal("default"),
        maxTurns: Type.Integer({ minimum: 2, maximum: 50 }),
        timeoutMs: Type.Integer({ minimum: 1_000, maximum: 1_800_000 }),
        network: Type.Literal("deny"),
        enableFileCheckpointing: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    lanes: Type.Array(Type.Union([ObservedLaneSchema, ExecuteLaneSchema]), { minItems: 2, maxItems: 6 }),
    contrasts: Type.Array(ContrastSchema, { minItems: 1, maxItems: 8 }),
    trials: Type.Object(
      {
        seed: Type.Integer({ minimum: 0, maximum: 4_294_967_295 }),
        order: Type.Literal("randomized"),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type HarnessExperimentManifest = Static<typeof HarnessExperimentManifestSchema>;
export type ExperimentLane = HarnessExperimentManifest["lanes"][number];
export type ObservedLane = Static<typeof ObservedLaneSchema>;
export type ExecuteLane = Static<typeof ExecuteLaneSchema>;
export type ExperimentContrast = HarnessExperimentManifest["contrasts"][number];

export function isObservedLane(lane: ExperimentLane): lane is ObservedLane {
  return lane.origin === "observed";
}

export function isExecuteLane(lane: ExperimentLane): lane is ExecuteLane {
  return lane.origin === "execute";
}

export function findLane(
  manifest: HarnessExperimentManifest,
  laneId: string,
): ExperimentLane | undefined {
  return manifest.lanes.find((lane) => lane.id === laneId);
}

export function invalidExperimentManifest(detail: string): Error {
  return new Error(`Invalid harness-experiment.v1 manifest: ${detail}.`);
}
