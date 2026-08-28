import { describe, expect, it } from "vitest";
import { OBSERVATION_KINDS, type Digest } from "../../src/agent-react/contracts/index.js";
import {
  createObservationBridge,
  HARNESS_ARTIFACT_OBSERVATION_EVENT,
} from "../../src/agent-react/host/observation-bridge.js";

const ARTIFACT: Digest = "sha256:artifact";
const BUILD: Digest = "sha256:build";

describe("ObservationBridge (AR-AC-10)", () => {
  it("numbers observations with strictly increasing sequences", () => {
    const bridge = createObservationBridge();

    const first = bridge.record({ kind: "compileDiagnostic" });
    const second = bridge.record({ kind: "renderCompleted" });

    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(bridge.recorded().map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("encodes an observation as a namespaced AG-UI CUSTOM event", () => {
    const bridge = createObservationBridge();
    const event = bridge.record({
      kind: "renderFailed",
      artifactDigest: ARTIFACT,
      buildDigest: BUILD,
      detail: { reason: "component threw" },
    });

    expect(bridge.encodeHarnessEvent(event)).toEqual({
      type: "CUSTOM",
      name: HARNESS_ARTIFACT_OBSERVATION_EVENT,
      value: {
        kind: "renderFailed",
        sequence: 1,
        artifactDigest: ARTIFACT,
        buildDigest: BUILD,
        detail: { reason: "component threw" },
      },
    });
  });

  it("omits digests and detail that were never recorded", () => {
    const bridge = createObservationBridge();
    const encoded = bridge.encodeHarnessEvent(bridge.record({ kind: "nodeSelected" }));

    expect(encoded.value).toEqual({ kind: "nodeSelected", sequence: 1 });
  });

  it("encodes every observation kind the runtime can report", () => {
    const bridge = createObservationBridge();
    for (const kind of OBSERVATION_KINDS) bridge.record({ kind, artifactDigest: ARTIFACT });

    const encoded = bridge.drainToAgent();

    expect(encoded).toHaveLength(OBSERVATION_KINDS.length);
    expect(encoded.every((event) => event.name === HARNESS_ARTIFACT_OBSERVATION_EVENT)).toBe(true);
    expect(encoded.map((event) => (event.value as { kind: string }).kind)).toEqual([...OBSERVATION_KINDS]);
  });

  it("owns and deeply freezes each recorded observation", () => {
    const bridge = createObservationBridge();
    const detail = { nested: { value: 1 } };
    const event = bridge.record({ kind: "annotationCreated", detail });
    detail.nested.value = 2;

    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.detail)).toBe(true);
    expect(Object.isFrozen(event.detail?.["nested"])).toBe(true);
    expect(event.detail).toEqual({ nested: { value: 1 } });
  });

  it("notifies a listener as observations arrive", () => {
    const seen: number[] = [];
    const bridge = createObservationBridge({ onRecord: (event) => seen.push(event.sequence) });

    bridge.record({ kind: "actionAttempted" });
    bridge.record({ kind: "actionDenied" });

    expect(seen).toEqual([1, 2]);
  });

  it("evicts the oldest observations but keeps sequences increasing", () => {
    const bridge = createObservationBridge({ maxRetained: 2 });

    bridge.record({ kind: "compileDiagnostic" });
    bridge.record({ kind: "profileViolation" });
    bridge.record({ kind: "runtimeException" });

    expect(bridge.recorded().map((event) => event.sequence)).toEqual([2, 3]);
    expect(bridge.recorded().map((event) => event.kind)).toEqual(["profileViolation", "runtimeException"]);
  });

  it("delivers live subscriptions even when no observations are retained", () => {
    const bridge = createObservationBridge({ maxRetained: 0 });
    const received: number[] = [];
    const unsubscribe = bridge.subscribe((event) => received.push(event.sequence));

    bridge.record({ kind: "actionAttempted" });
    unsubscribe();
    bridge.record({ kind: "actionDenied" });

    expect(received).toEqual([1]);
    expect(bridge.recorded()).toEqual([]);
  });

  it("rejects invalid retention bounds instead of looping during record", () => {
    expect(() => createObservationBridge({ maxRetained: -1 })).toThrow(/non-negative safe integer/);
    expect(() => createObservationBridge({ maxRetained: 1.5 })).toThrow(/non-negative safe integer/);
  });

  it("clears retained observations without resetting the sequence", () => {
    const bridge = createObservationBridge();
    bridge.record({ kind: "stateValidationFailed" });

    bridge.clear();

    expect(bridge.recorded()).toEqual([]);
    expect(bridge.record({ kind: "nodeSelected" }).sequence).toBe(2);
  });
});
