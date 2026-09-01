import type { Digest, ObservationEvent, ObservationInput } from "../contracts/index.js";
import { cloneAndFreezePlainData } from "./data-ownership.js";

/**
 * Namespaced observation event.
 *
 * Artifact observations own a domain envelope because a render is neither an
 * executor lifecycle event nor host protocol traffic.
 */
export const HARNESS_ARTIFACT_OBSERVATION_EVENT = "harness.artifact-observation";

export interface ArtifactObservationPayload {
  readonly kind: ObservationEvent["kind"];
  readonly sequence: number;
  readonly artifactDigest?: Digest;
  readonly buildDigest?: Digest;
  readonly detail?: Record<string, unknown>;
}

export interface ArtifactObservationEnvelope {
  readonly type: typeof HARNESS_ARTIFACT_OBSERVATION_EVENT;
  readonly payload: ArtifactObservationPayload;
}

export interface ObservationBridge {
  record(observation: ObservationInput): ObservationEvent;
  encodeObservation(observation: ObservationEvent): ArtifactObservationEnvelope;
  /** Recorded observations in order, oldest first, bounded by `maxRetained`. */
  recorded(): readonly ObservationEvent[];
  /** Every retained observation encoded for an Agent-facing stream. */
  drainEnvelopes(): readonly ArtifactObservationEnvelope[];
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
    encodeObservation(observation) {
      const payload: ArtifactObservationPayload = {
        kind: observation.kind,
        sequence: observation.sequence,
        ...(observation.artifactDigest === undefined ? {} : { artifactDigest: observation.artifactDigest }),
        ...(observation.buildDigest === undefined ? {} : { buildDigest: observation.buildDigest }),
        ...(observation.detail === undefined ? {} : { detail: observation.detail }),
      };
      return { type: HARNESS_ARTIFACT_OBSERVATION_EVENT, payload };
    },
    recorded() {
      return [...events];
    },
    drainEnvelopes() {
      return events.map((event) => bridge.encodeObservation(event));
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
