import type {
  BuildSnapshot,
  CapabilityGrant,
  FrameFactory,
  FrameHandle,
  FrameVerification,
} from "../../contracts/index.js";
import type { CapabilityBroker } from "../capability.js";
import type { ObservationBridge } from "../observation-bridge.js";
import type { ArtifactStateStore } from "../state-store.js";

export type StageOutcome =
  | { readonly status: "staged"; readonly frame: FrameHandle; readonly grant: CapabilityGrant }
  | { readonly status: "rejected"; readonly reason: string; readonly verification?: FrameVerification };

export interface SandboxFrameController {
  readonly current: FrameHandle | undefined;
  readonly staging: FrameHandle | undefined;
  stage(snapshot: BuildSnapshot): Promise<StageOutcome>;
  /** Atomically promotes the verified staging frame; disposes the old Current. */
  activate(): FrameHandle;
  discard(): void;
  /** Re-stages and commits the snapshot Current held before the last activation. */
  rollback(): Promise<StageOutcome>;
}

export interface SandboxFrameControllerOptions {
  readonly frames: FrameFactory;
  readonly broker: CapabilityBroker;
  readonly observations: ObservationBridge;
  readonly state: ArtifactStateStore;
  readonly verificationTimeoutMs?: number;
  /** Explicit test/experiment opt-in; in-process execution is never production isolation. */
  readonly allowInProcessVerification?: boolean;
  /**
   * When set, a dry-run Action attempted during staging blocks the commit. Some
   * Hosts want the attempt as information only; others treat "this build tries to
   * act before it is trusted" as disqualifying.
   */
  readonly blockOnDeniedAction?: boolean;
}

const DEFAULT_VERIFICATION_TIMEOUT_MS = 5_000;

/**
 * Two-frame transactional commit.
 *
 * In production a new build is verified in its own opaque-origin frame while
 * the working view keeps running, and only a frame that reported
 * `renderCompleted` may replace it. In-process factories require explicit
 * verification-only admission and carry no isolation claim.
 * Mounting the new build directly into the live frame would make every failed
 * revision visible as a blank or broken view — the agent's mistakes would become
 * the user's outage.
 */
export function createSandboxFrameController(options: SandboxFrameControllerOptions): SandboxFrameController {
  if (options.frames.isolation !== "opaque-origin" && options.allowInProcessVerification !== true) {
    throw new Error(
      "An in-process FrameFactory is verification-only; production controllers require opaque-origin isolation.",
    );
  }
  const timeoutMs = options.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
  let current: FrameHandle | undefined;
  let staging: FrameHandle | undefined;
  let previousSnapshot: BuildSnapshot | undefined;
  let stageGeneration = 0;

  const disposeFrame = (frame: FrameHandle): void => {
    options.broker.revokeFrameToken(frame.frameToken.token);
    frame.dispose();
    if (staging === frame) staging = undefined;
  };

  const disposeStaging = (): void => {
    if (staging !== undefined) disposeFrame(staging);
  };

  const controller: SandboxFrameController = {
    get current() {
      return current;
    },
    get staging() {
      return staging;
    },

    async stage(snapshot) {
      if (snapshot.status !== "ready") {
        return { status: "rejected", reason: "Build Snapshot is not runnable." };
      }
      if (snapshot.viewDeclaration === undefined) {
        return { status: "rejected", reason: "Build Snapshot carries no Artifact View declaration." };
      }
      stageGeneration += 1;
      const mine = stageGeneration;
      disposeStaging();

      const grant = options.broker.computeGrant(snapshot.viewDeclaration);
      const token = options.broker.issueFrameToken(snapshot.buildDigest, "dry-run", grant);
      const frame = options.frames.create(snapshot, {
        actionMode: "dry-run",
        frameToken: token,
        // A staging frame reads a frozen copy so verification cannot mutate what
        // the still-live Current frame is displaying.
        state: options.state.snapshot(),
      });
      staging = frame;
      const isActiveStage = (): boolean => stageGeneration === mine && staging === frame && !frame.disposed;

      let attemptedAction = false;
      const unsubscribeObservations = options.observations.subscribe((event) => {
        if (event.kind === "actionAttempted" && event.buildDigest === snapshot.buildDigest) attemptedAction = true;
      });
      let verification: FrameVerification;
      try {
        await frame.mount();
        verification = await frame.waitForRenderCompleted(timeoutMs);
      } catch (error) {
        verification = { status: "renderFailed", message: error instanceof Error ? error.message : String(error) };
      } finally {
        unsubscribeObservations();
      }

      if (!isActiveStage()) {
        disposeFrame(frame);
        return { status: "rejected", reason: "Staging build was superseded by a newer generation." };
      }

      if (verification.status !== "renderCompleted") {
        const reason = verification.status === "renderFailed"
          ? verification.message
          : `Staging render exceeded ${timeoutMs}ms.`;
        options.observations.record({
          kind: "renderFailed",
          artifactDigest: snapshot.artifactDigest,
          buildDigest: snapshot.buildDigest,
          detail: { reason, phase: "staging" },
        });
        disposeFrame(frame);
        return { status: "rejected", reason, verification };
      }

      if (options.blockOnDeniedAction === true) {
        if (attemptedAction) {
          options.observations.record({
            kind: "actionDenied",
            artifactDigest: snapshot.artifactDigest,
            buildDigest: snapshot.buildDigest,
            detail: { reason: "Build attempted an Action during staging verification.", phase: "staging" },
          });
          disposeFrame(frame);
          return { status: "rejected", reason: "Build attempted an Action during staging verification.", verification };
        }
      }

      options.observations.record({
        kind: "renderCompleted",
        artifactDigest: snapshot.artifactDigest,
        buildDigest: snapshot.buildDigest,
        detail: { phase: "staging", refusedCapabilities: grant.refused.map((entry) => entry.capability) },
      });
      return { status: "staged", frame, grant };
    },

    activate() {
      const promoted = staging;
      if (promoted === undefined) throw new Error("No verified staging frame is available to activate.");
      const outgoing = current;
      const stagingToken = promoted.frameToken.token;

      const liveToken = options.broker.issueFrameToken(
        promoted.snapshot.buildDigest,
        "live",
        { granted: promoted.frameToken.granted, refused: [] },
      );
      try {
        promoted.activate(liveToken);
      } catch (error) {
        options.broker.revokeFrameToken(liveToken.token);
        throw error;
      }
      options.broker.revokeFrameToken(stagingToken);

      current = promoted;
      staging = undefined;
      if (outgoing !== undefined) {
        previousSnapshot = outgoing.snapshot;
        disposeFrame(outgoing);
      }
      options.observations.record({
        kind: "renderCompleted",
        artifactDigest: promoted.snapshot.artifactDigest,
        buildDigest: promoted.snapshot.buildDigest,
        detail: { phase: "committed" },
      });
      return promoted;
    },

    discard() {
      stageGeneration += 1;
      disposeStaging();
    },

    async rollback() {
      if (previousSnapshot === undefined) {
        return { status: "rejected", reason: "No previous Build Snapshot is retained to roll back to." };
      }
      const target = previousSnapshot;
      const staged = await controller.stage(target);
      if (staged.status !== "staged") return staged;
      controller.activate();
      options.observations.record({
        kind: "renderCompleted",
        artifactDigest: target.artifactDigest,
        buildDigest: target.buildDigest,
        detail: { phase: "rolled-back" },
      });
      return staged;
    },
  };

  return controller;
}
