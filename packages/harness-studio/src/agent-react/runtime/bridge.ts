import type { ActionMode, ActionOutcome } from "../contracts/index.js";
import type { NodeAddressRegistry } from "./address-registry.js";

/**
 * The seam between artifact code and its Host.
 *
 * In a real sandbox frame this is backed by the transferred `MessagePort`; in
 * tests it is backed by the in-process Host directly. Artifact code never sees
 * either: it only ever calls the hooks in `runtime/index.ts`.
 */
export interface ArtifactRuntimeBridge {
  readonly artifactDigest: string;
  readonly buildDigest: string;
  readonly actionMode: ActionMode;
  readonly registry: NodeAddressRegistry;
  getState(path: string): unknown;
  setState(path: string, value: unknown): void;
  subscribe(path: string, listener: () => void): () => void;
  dispatchAction(capability: string, payload?: unknown): Promise<ActionOutcome>;
}

/**
 * `jsxDEV` is called during element creation, outside any React context, so the
 * bridge has to be reachable through the module scope. One frame hosts exactly
 * one Artifact build, which is what makes a module-level slot safe here.
 */
let active: ArtifactRuntimeBridge | undefined;

export function setActiveArtifactRuntime(bridge: ArtifactRuntimeBridge | undefined): void {
  active = bridge;
}

/** Clears only the bridge installed by the caller, never a newer frame's bridge. */
export function clearActiveArtifactRuntime(bridge: ArtifactRuntimeBridge): void {
  if (active === bridge) active = undefined;
}

export function activeArtifactRuntime(): ArtifactRuntimeBridge | undefined {
  return active;
}

export function requireActiveArtifactRuntime(): ArtifactRuntimeBridge {
  if (active === undefined) {
    throw new Error("No Artifact runtime is active; an Artifact View must be mounted by the Host.");
  }
  return active;
}
