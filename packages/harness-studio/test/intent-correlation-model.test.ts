import { describe, expect, it } from "vitest";
import type { UserInputTraceV1 } from "../src/input-trace-model.js";
import {
  IntentCorrelationContractError,
  validateIntentCorrelationAnalysis,
  type IntentCorrelationAnalysisV1,
} from "../src/intent-correlation-model.js";
import { buildIntentCorrelationPacket } from "../src/server/intent-correlation.js";

const TRACE: UserInputTraceV1 = {
  kind: "UserInputTraceV1",
  schemaVersion: 1,
  workspace: { label: "fixture-repository" },
  inputs: [{
    id: "codex/session-a#turn-1",
    provider: "codex",
    sessionId: "session-a",
    turnIndex: 1,
    text: "Understand the model, then update its view.",
    observedAt: "2026-08-22T01:00:00.000Z",
    links: [{ path: "src/model.ts", activity: "read", callIds: ["read-1"], callCount: 1 }, { path: "src/view.tsx", activity: "edit-targeted", callIds: ["edit-1"], callCount: 1 }],
  }],
  summary: { inputCount: 1, linkedInputCount: 1, unlinkedInputCount: 0, readCount: 1, editTargetCount: 1, fileCount: 2, truncatedSessionCount: 0 },
};

function validAnalysis(packet = buildIntentCorrelationPacket(TRACE)): IntentCorrelationAnalysisV1 {
  const input = packet.inputs[0]!;
  const readEdge = packet.observedEdges.find((edge) => edge.predicate === "read")!;
  return {
    kind: "IntentCorrelationAnalysisV1",
    schemaVersion: 1,
    packetDigest: packet.packetDigest,
    intentProposals: [{ id: "intent:proposed:update-view", title: "Update the view", summary: "Relate the retained input to the view target while preserving the missing delta boundary.", sourceRefs: [input.ref], reviewStatus: "proposed" }],
    claims: [{
      id: "claim:input-creates-view-intent",
      subjectRef: input.ref,
      predicate: "creates",
      objectRef: "intent:proposed:update-view",
      evidenceRefs: [readEdge.ref],
      counterEvidenceRefs: [],
      alternatives: [],
      evidenceStrength: "observed",
      confidence: { semanticFit: "high", temporalFit: "high", changeFit: "low", acceptanceFit: "low" },
      reason: "The retained input states the view goal and the execution slice observed supporting repository context.",
      limitations: ["The edit target has no verified content delta."],
      reviewStatus: "proposed",
    }],
    unassignedRefs: packet.changeUnits.map(({ ref }) => ref),
    unresolved: [],
  };
}

describe("Intent correlation packet", () => {
  it("keeps reads as context and edit operations as unverified targets", () => {
    const packet = buildIntentCorrelationPacket(TRACE);

    expect(packet.packetDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(packet.files.map(({ path }) => path)).toEqual(["src/model.ts", "src/view.tsx"]);
    expect(packet.observedEdges.map(({ predicate }) => predicate)).toEqual(["contains", "read", "edit-targeted"]);
    expect(packet.changeUnits).toEqual([expect.objectContaining({ path: "src/view.tsx", kind: "edit-target", changeState: "edit-targeted" })]);
    expect(JSON.stringify(packet)).not.toContain("/Users/");
  });

  it("accepts only locally reviewable proposed claims", () => {
    const packet = buildIntentCorrelationPacket(TRACE);
    expect(validateIntentCorrelationAnalysis(packet, validAnalysis(packet))).toMatchObject({ claims: [{ reviewStatus: "proposed" }] });
  });

  it("rejects a model that promotes an edit target to implementation", () => {
    const packet = buildIntentCorrelationPacket(TRACE);
    const analysis = validAnalysis(packet);
    analysis.claims[0] = {
      ...analysis.claims[0]!,
      subjectRef: packet.changeUnits[0]!.ref,
      predicate: "implements",
      evidenceRefs: [packet.observedEdges.find((edge) => edge.predicate === "edit-targeted")!.ref],
    };
    expect(() => validateIntentCorrelationAnalysis(packet, analysis)).toThrow(IntentCorrelationContractError);
  });

  it("rejects a valid edge that is unrelated to the claim subject", () => {
    const trace: UserInputTraceV1 = {
      ...TRACE,
      inputs: [
        ...TRACE.inputs,
        { ...TRACE.inputs[0]!, id: "codex/session-b#turn-1", sessionId: "session-b", text: "An unrelated retained input." },
      ],
      summary: { ...TRACE.summary, inputCount: 2, linkedInputCount: 2, readCount: 2, editTargetCount: 2 },
    };
    const packet = buildIntentCorrelationPacket(trace);
    const analysis = validAnalysis(packet);
    analysis.claims[0] = { ...analysis.claims[0]!, subjectRef: packet.inputs[1]!.ref };

    expect(() => validateIntentCorrelationAnalysis(packet, analysis)).toThrow(/must connect to its subjectRef/u);
  });

  it("rejects a formally shaped but empty analysis for retained inputs", () => {
    const packet = buildIntentCorrelationPacket(TRACE);
    expect(() => validateIntentCorrelationAnalysis(packet, {
      kind: "IntentCorrelationAnalysisV1",
      schemaVersion: 1,
      packetDigest: packet.packetDigest,
      intentProposals: [],
      claims: [],
      unassignedRefs: [],
      unresolved: [],
    })).toThrow(/at least one proposal/u);
  });
});
