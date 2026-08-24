import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
  computePacketDigest,
  validateAnalysis,
  validatePacket,
} from "../../skills/intent-correlation-analysis/scripts/validate-analysis.mjs";

const packetPath = new URL("../fixtures/intent-correlation/packet.json", import.meta.url);

async function fixturePacket() {
  return JSON.parse(await readFile(packetPath, "utf8"));
}

function validAnalysis(packet) {
  return {
    kind: "IntentCorrelationAnalysisV1",
    schemaVersion: 1,
    packetDigest: packet.packetDigest,
    intentProposals: [{
      id: "intent:proposed:studio-input-trace",
      title: "Connect prompts to observed workspace activity",
      summary: "Expose prompt-to-file evidence while preserving uncertainty around unverified edits.",
      sourceRefs: ["input:codex-session-a-turn-1", "input:codex-session-a-turn-2"],
      reviewStatus: "proposed",
    }],
    claims: [{
      id: "claim:input-creates-trace-intent",
      subjectRef: "input:codex-session-a-turn-1",
      predicate: "creates",
      objectRef: "intent:proposed:studio-input-trace",
      evidenceRefs: ["edge:turn-1-contains-slice"],
      counterEvidenceRefs: [],
      alternatives: [],
      evidenceStrength: "direct",
      confidence: { semanticFit: "high", temporalFit: "high", changeFit: "medium", acceptanceFit: "low" },
      reason: "The input directly asks for a prompt-to-file Intent view and begins the observed execution slice.",
      limitations: ["The packet does not show whether the complete UI was accepted."],
      reviewStatus: "proposed",
    }, {
      id: "claim:model-hunk-implements-trace-intent",
      subjectRef: "change:hunk-input-trace-model-1",
      predicate: "implements",
      objectRef: "intent:proposed:studio-input-trace",
      evidenceRefs: ["edge:slice-1-content-changed-model"],
      counterEvidenceRefs: [],
      alternatives: [],
      evidenceStrength: "observed",
      confidence: { semanticFit: "high", temporalFit: "high", changeFit: "high", acceptanceFit: "medium" },
      reason: "The verified hunk projects prompts and operations into the requested trace model.",
      limitations: ["The packet has no commit linkage or browser acceptance receipt."],
      reviewStatus: "proposed",
    }],
    unassignedRefs: ["change:target-app-tsx", "edge:slice-1-targeted-app"],
    unresolved: [{
      id: "question:app-target-delta",
      question: "Did the edit attempt against App.tsx produce a content delta belonging to this Intent?",
      evidenceRefs: ["change:target-app-tsx", "edge:slice-1-targeted-app"],
    }],
  };
}

test("validates a bounded evidence packet and reviewable proposed claims", async () => {
  const packet = await fixturePacket();
  assert.equal(packet.packetDigest, computePacketDigest(packet));
  assert.equal(validatePacket(packet).allowedRefs.size, packet.allowedRefs.length);
  assert.deepEqual(validateAnalysis(packet, validAnalysis(packet)), {
    intentProposalCount: 1,
    claimCount: 2,
    unresolvedCount: 1,
  });
});

test("rejects an invented evidence ref", async () => {
  const packet = await fixturePacket();
  const analysis = validAnalysis(packet);
  analysis.claims[0].evidenceRefs = ["edge:invented"];
  assert.throws(() => validateAnalysis(packet, analysis), /unknown ref 'edge:invented'/u);
});

test("rejects evidence that does not connect to the claim subject", async () => {
  const packet = await fixturePacket();
  const analysis = validAnalysis(packet);
  analysis.claims[0].subjectRef = "input:codex-session-a-turn-2";
  assert.throws(() => validateAnalysis(packet, analysis), /must connect to its subjectRef/u);
});

test("rejects promoting an edit target to an implemented change", async () => {
  const packet = await fixturePacket();
  const analysis = validAnalysis(packet);
  analysis.claims[1].subjectRef = "change:target-app-tsx";
  analysis.claims[1].evidenceRefs = ["edge:slice-1-targeted-app"];
  assert.throws(() => validateAnalysis(packet, analysis), /cannot use 'implements' for edit-targeted evidence/u);
});

test("rejects self-confirmation and aggregate scoring", async () => {
  const packet = await fixturePacket();
  const confirmed = validAnalysis(packet);
  confirmed.claims[0].reviewStatus = "confirmed";
  assert.throws(() => validateAnalysis(packet, confirmed), /reviewStatus must equal 'proposed'/u);

  const scored = validAnalysis(packet);
  scored.claims[0].confidence.score = 0.92;
  assert.throws(() => validateAnalysis(packet, scored), /unsupported aggregate score/u);
});

test("rejects an empty narrative for a non-empty packet", async () => {
  const packet = await fixturePacket();
  assert.throws(() => validateAnalysis(packet, {
    kind: "IntentCorrelationAnalysisV1",
    schemaVersion: 1,
    packetDigest: packet.packetDigest,
    intentProposals: [],
    claims: [],
    unassignedRefs: [],
    unresolved: [],
  }), /at least one proposal/u);
});
