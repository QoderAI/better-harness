import type { BuildSnapshot } from "./build.js";
import type { ArtifactViewDeclaration } from "./compile.js";
import type { Digest } from "./revision.js";

/**
 * What the Artifact Host owes a frame: a grant, a state view, and a channel to
 * report what happened. Every type here is transport-free, so the same contract
 * serves an in-process frame and an opaque-origin iframe.
 */

// ---------------------------------------------------------------------------
// Capabilities and actions
// ---------------------------------------------------------------------------

export type ActionMode = "live" | "dry-run" | "denied";

export type CapabilityRefusal = "not-in-policy" | "awaiting-approval";

export interface CapabilityGrant {
  readonly granted: readonly string[];
  /** Kept rather than dropped so a Surface can explain a missing control. */
  readonly refused: readonly { readonly capability: string; readonly reason: CapabilityRefusal }[];
}

export interface FrameToken {
  readonly token: string;
  readonly buildDigest: Digest;
  readonly actionMode: ActionMode;
  readonly granted: readonly string[];
}

export type ActionOutcome =
  | { readonly status: "completed"; readonly result: unknown }
  | { readonly status: "dry-run" }
  | { readonly status: "denied"; readonly reason: string };

export interface ActionRequest {
  readonly frameToken: string;
  readonly capability: string;
  readonly payload?: unknown;
}

/** Requests the Host may grant; the code's declaration is only the left operand. */
export type CapabilityRequests = Pick<ArtifactViewDeclaration, "capabilities">;

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

export const OBSERVATION_KINDS = [
  "compileDiagnostic",
  "profileViolation",
  "renderCompleted",
  "renderFailed",
  "actionAttempted",
  "actionDenied",
  "stateValidationFailed",
  "nodeSelected",
  "annotationCreated",
  "runtimeException",
] as const;

export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

export interface ObservationInput {
  readonly kind: ObservationKind;
  readonly artifactDigest?: Digest;
  readonly buildDigest?: Digest;
  readonly detail?: Record<string, unknown>;
}

export interface ObservationEvent extends ObservationInput {
  readonly sequence: number;
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

export interface FrameMountOptions {
  readonly actionMode: ActionMode;
  readonly frameToken: FrameToken;
  /** Frozen state snapshot handed to a staging frame; live frames subscribe instead. */
  readonly state: Readonly<Record<string, unknown>>;
}

export type FrameVerification =
  | { readonly status: "renderCompleted" }
  | { readonly status: "renderFailed"; readonly message: string }
  | { readonly status: "timedOut" };

export interface FrameHandle {
  readonly snapshot: BuildSnapshot;
  /** Reflects the token the frame currently holds, so promotion is observable. */
  readonly actionMode: ActionMode;
  readonly frameToken: FrameToken;
  mount(): Promise<void>;
  /** Resolves with the first terminal render outcome, or `timedOut`. */
  waitForRenderCompleted(timeoutMs: number): Promise<FrameVerification>;
  /**
   * Promotes a verified staging frame by handing it a live token. The frame's
   * action mode is decided by the token the Host issues, never by the frame.
   */
  activate(token: FrameToken): void;
  dispose(): void;
  readonly disposed: boolean;
}

export type FrameIsolation = "opaque-origin" | "in-process";

export interface FrameFactory {
  /** Production controllers admit only an opaque-origin transport by default. */
  readonly isolation: FrameIsolation;
  create(snapshot: BuildSnapshot, options: FrameMountOptions): FrameHandle;
}
