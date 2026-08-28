import { useCallback, useSyncExternalStore } from "react";
import type { ActionOutcome } from "../contracts/index.js";
import {
  type ArtifactRuntimeBridge,
  activeArtifactRuntime,
  clearActiveArtifactRuntime,
  requireActiveArtifactRuntime,
  setActiveArtifactRuntime,
} from "./bridge.js";

/**
 * `@studio/agent-react` — the only module an Artifact View may import besides
 * `react` and the (future) Component Catalog.
 */

export { setActiveArtifactRuntime, clearActiveArtifactRuntime, activeArtifactRuntime };
export type { ArtifactRuntimeBridge };
// Re-exported from the contract, not redefined here: an Artifact View needs
// `ARTIFACT_NODE_PROP` to forward addressing, and the compiler needs the same
// hash. One definition, two importers.
export {
  ARTIFACT_NODE_ATTRIBUTE,
  ARTIFACT_NODE_PROP,
  instanceAddress,
  sourceNodeId,
  stableHash,
} from "../contracts/addressing.js";
export type { SourceSpan } from "../contracts/addressing.js";
export { createNodeAddressRegistry } from "./address-registry.js";
export type { NodeAddressRegistry } from "./address-registry.js";
export {
  createBrowserArtifactRuntimeSession,
  type BrowserArtifactRuntimeContext,
  type BrowserArtifactRuntimeSession,
} from "./browser-bridge.js";

export interface ArtifactStateSpec {
  readonly schema: string;
  readonly version: number;
}

export interface ArtifactViewInput<P = Record<string, unknown>> {
  readonly id: string;
  readonly state?: Readonly<Record<string, ArtifactStateSpec>>;
  readonly capabilities?: readonly string[];
  readonly component: (props: P) => unknown;
}

export interface ArtifactViewDefinition<P = Record<string, unknown>> {
  readonly kind: "agent-react.artifact-view/v1";
  readonly id: string;
  readonly state: Readonly<Record<string, ArtifactStateSpec>>;
  readonly capabilities: readonly string[];
  readonly component: (props: P) => unknown;
}

/**
 * Declares the Artifact View.
 *
 * The compiler reads the same literal statically, so this function does no
 * validation the Host would depend on: it only produces the runtime value. If it
 * *did* compute the declaration, a build could ship a manifest the compiler had
 * never seen, and the ABI check would become decorative.
 */
export function defineArtifactView<P = Record<string, unknown>>(input: ArtifactViewInput<P>): ArtifactViewDefinition<P> {
  if (typeof input.component !== "function") {
    throw new TypeError(`Artifact View '${input.id}' must declare a function component.`);
  }
  return Object.freeze({
    kind: "agent-react.artifact-view/v1" as const,
    id: input.id,
    state: Object.freeze({ ...(input.state ?? {}) }),
    capabilities: Object.freeze([...new Set(input.capabilities ?? [])].sort()),
    component: input.component,
  });
}

export function isArtifactViewDefinition(value: unknown): value is ArtifactViewDefinition {
  return typeof value === "object"
    && value !== null
    && (value as { kind?: unknown }).kind === "agent-react.artifact-view/v1";
}

/**
 * Reads and writes persistent Artifact state, which lives in the Host.
 *
 * `useState` remains the right tool for hover, focus, and animation. Anything the
 * Host must validate, migrate, or hand to a staging frame has to come through
 * here, because a value that only exists in a component cannot survive the frame
 * swap that commits a new build.
 */
export function useArtifactState<T>(path: string): [T, (next: T) => void] {
  const runtime = requireActiveArtifactRuntime();
  const subscribe = useCallback(
    (listener: () => void) => runtime.subscribe(path, listener),
    [runtime, path],
  );
  const read = useCallback(() => runtime.getState(path) as T, [runtime, path]);
  const value = useSyncExternalStore(subscribe, read, read);
  const write = useCallback((next: T) => runtime.setState(path, next), [runtime, path]);
  return [value, write];
}

/** Requests a capability-gated side effect. The Host decides what actually happens. */
export function useArtifactAction(capability: string): (payload?: unknown) => Promise<ActionOutcome> {
  const runtime = requireActiveArtifactRuntime();
  return useCallback(
    (payload?: unknown) => runtime.dispatchAction(capability, payload),
    [runtime, capability],
  );
}
