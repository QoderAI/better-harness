import type { AguiCustomEvent } from "@qoder-ai/harness-ui/protocol";
import type { Digest, ObservationEvent, ObservationInput } from "../contracts/index.js";
import { cloneAndFreezePlainData } from "./data-ownership.js";

/**
 * Namespaced observation event.
 *
 * The source design routed these through `HARNESS_PROTOCOL_EVENT`, but that
 * constant's payload is ACP protocol evidence (`protocol: "acp"`), and an artifact
 * render is not ACP traffic. Reusing it would let a consumer read a render failure
 * as a protocol receipt, so the AG-UI `CUSTOM` envelope is kept and only the name
 * is new.
 */
export const HARNESS_ARTIFACT_OBSERVATION_EVENT = "harness.artifact-observation";

export interface ArtifactObservationPayload {
  readonly kind: ObservationEvent["kind"];
  readonly sequence: number;
  readonly artifactDigest?: Digest;
  readonly buildDigest?: Digest;
  readonly detail?: Record<string, unknown>;
}

export interface ObservationBridge {
  record(observation: ObservationInput): ObservationEvent;
  encodeHarnessEvent(observation: ObservationEvent): AguiCustomEvent;
  /** Recorded observations in order, oldest first, bounded by `maxRetained`. */
  recorded(): readonly ObservationEvent[];
  /** Every recorded observation encoded for an AG-UI stream. */
  drainToAgent(): readonly AguiCustomEvent[];
  /** Observes live events even when the bounded retained buffer evicts them. */
  subscribe(listener: (observation: ObservationEvent) => void): () => void;
  clear(): void;
}

export interface ObservationBridgeOptions {
  readonly maxRetained?: number;
  readonly onRecord?: (observation: ObservationEvent) => void;
}

const DEFAULT_MAX_RETAINED = 512;

export function createObservationBridge(options: ObservationBridgeOptions = {}): ObservationBridge {
  const maxRetained = options.maxRetained ?? DEFAULT_MAX_RETAINED;
  if (!Number.isSafeInteger(maxRetained) || maxRetained < 0) {
    throw new TypeError("Observation maxRetained must be a non-negative safe integer.");
  }
  const events: ObservationEvent[] = [];
  const listeners = new Set<(observation: ObservationEvent) => void>();
  let sequence = 0;

  const bridge: ObservationBridge = {
    record(observation) {
      sequence += 1;
      const event = cloneAndFreezePlainData<ObservationEvent>(
        { ...observation, sequence },
        "Artifact observation",
      );
      events.push(event);
      // Sequence numbers keep increasing after eviction: an agent that only sees
      // the tail must still be able to tell that something was dropped.
      while (events.length > maxRetained) events.shift();
      options.onRecord?.(event);
      for (const listener of listeners) listener(event);
      return event;
    },
    encodeHarnessEvent(observation) {
      const payload: ArtifactObservationPayload = {
        kind: observation.kind,
        sequence: observation.sequence,
        ...(observation.artifactDigest === undefined ? {} : { artifactDigest: observation.artifactDigest }),
        ...(observation.buildDigest === undefined ? {} : { buildDigest: observation.buildDigest }),
        ...(observation.detail === undefined ? {} : { detail: observation.detail }),
      };
      return { type: "CUSTOM", name: HARNESS_ARTIFACT_OBSERVATION_EVENT, value: payload };
    },
    recorded() {
      return [...events];
    },
    drainToAgent() {
      return events.map((event) => bridge.encodeHarnessEvent(event));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      events.length = 0;
    },
  };
  return bridge;
}
