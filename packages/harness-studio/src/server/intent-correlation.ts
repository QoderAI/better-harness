import { createHash } from "node:crypto";
import type { UserInputRecord, UserInputTraceV1 } from "../input-trace-model.js";
import {
  INTENT_CORRELATION_PACKET_KIND,
  type IntentChangeUnitEvidence,
  type IntentCorrelationPacketV1,
  type IntentExecutionSliceEvidence,
  type IntentFileEvidence,
  type IntentInputEvidence,
  type IntentObservedEdge,
} from "../intent-correlation-model.js";

const MAX_ANALYSIS_INPUTS = 8;
const MAX_ANALYSIS_LINKS = 160;

export function buildIntentCorrelationPacket(trace: UserInputTraceV1): IntentCorrelationPacketV1 {
  const selected = trace.inputs.slice(0, MAX_ANALYSIS_INPUTS);
  const inputRefs = new Map(selected.map((input) => [input.id, `input:${digestRef(input.id)}`]));
  const sliceRefs = new Map(selected.map((input) => [input.id, `slice:${digestRef(input.id)}`]));
  const inputEvidence: IntentInputEvidence[] = selected.map((input) => ({
    ref: inputRefs.get(input.id)!,
    sessionId: input.sessionId,
    sliceRef: sliceRefs.get(input.id)!,
    turnIndex: input.turnIndex,
    text: input.text,
    observedAt: input.observedAt,
  }));
  const executionSlices = selected.map((input) => executionSlice(input, selected, inputRefs, sliceRefs));

  const files = new Map<string, IntentFileEvidence>();
  const changeUnits: IntentChangeUnitEvidence[] = [];
  const observedEdges: IntentObservedEdge[] = [];
  let retainedLinks = 0;
  let linksTruncated = false;
  for (const input of selected) {
    const inputRef = inputRefs.get(input.id)!;
    const sliceRef = sliceRefs.get(input.id)!;
    observedEdges.push({
      ref: `edge:${digestRef(`${input.id}:contains`)}`,
      subjectRef: inputRef,
      predicate: "contains",
      objectRef: sliceRef,
      strength: "direct",
      evidenceRefs: [inputRef, sliceRef],
      limitations: [],
    });
    for (const link of input.links) {
      if (retainedLinks >= MAX_ANALYSIS_LINKS) {
        linksTruncated = true;
        break;
      }
      retainedLinks += 1;
      const fileRef = `file:${digestRef(link.path)}`;
      files.set(link.path, { ref: fileRef, path: link.path });
      if (link.activity === "read") {
        observedEdges.push({
          ref: `edge:${digestRef(`${input.id}:read:${link.path}`)}`,
          subjectRef: sliceRef,
          predicate: "read",
          objectRef: fileRef,
          strength: "observed",
          evidenceRefs: [inputRef, fileRef],
          limitations: ["A file read establishes context, not contribution to the user's goal."],
        });
        continue;
      }
      const changeRef = `change:${digestRef(`${input.id}:target:${link.path}`)}`;
      changeUnits.push({
        ref: changeRef,
        fileRef,
        path: link.path,
        kind: "edit-target",
        changeState: "edit-targeted",
        summary: `An edit operation targeted ${link.path}; this packet contains no verified content delta.`,
      });
      observedEdges.push({
        ref: `edge:${digestRef(`${input.id}:edit-targeted:${link.path}`)}`,
        subjectRef: sliceRef,
        predicate: "edit-targeted",
        objectRef: changeRef,
        strength: "observed",
        evidenceRefs: [inputRef, changeRef, fileRef],
        limitations: ["Tool targeting does not prove that file content changed."],
      });
    }
  }
  const packetWithoutDigest = {
    kind: INTENT_CORRELATION_PACKET_KIND,
    schemaVersion: 1 as const,
    workspace: { label: trace.workspace.label },
    inputs: inputEvidence,
    executionSlices,
    files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path)),
    changeUnits,
    commits: [],
    artifacts: [],
    validations: [],
    observedEdges,
    allowedRefs: [
      ...inputEvidence.map(({ ref }) => ref),
      ...executionSlices.map(({ ref }) => ref),
      ...[...files.values()].map(({ ref }) => ref),
      ...changeUnits.map(({ ref }) => ref),
      ...observedEdges.map(({ ref }) => ref),
    ].sort(),
    limitations: [
      "UserInputTraceV1 retains tool file targets but not verified content deltas; edit operations remain edit-targeted.",
      "This packet contains no commit, artifact, or validation evidence.",
      "A file read establishes context but does not prove semantic contribution to an Intent.",
      ...(selected.length < trace.inputs.length ? [`Only the ${MAX_ANALYSIS_INPUTS} most recent retained inputs are included.`] : []),
      ...(linksTruncated ? [`File-operation evidence is capped at ${MAX_ANALYSIS_LINKS} links.`] : []),
      ...(trace.summary.truncatedSessionCount > 0 ? [`${trace.summary.truncatedSessionCount} Session dialogue projection(s) were already truncated.`] : []),
    ],
  };
  return { ...packetWithoutDigest, packetDigest: `sha256:${createHash("sha256").update(canonicalJson(packetWithoutDigest)).digest("hex")}` };
}

function executionSlice(
  input: UserInputRecord,
  inputs: readonly UserInputRecord[],
  inputRefs: Map<string, string>,
  sliceRefs: Map<string, string>,
): IntentExecutionSliceEvidence {
  const next = inputs
    .filter((candidate) => candidate.sessionId === input.sessionId && candidate.provider === input.provider && candidate.turnIndex > input.turnIndex)
    .sort((left, right) => left.turnIndex - right.turnIndex)[0];
  return {
    ref: sliceRefs.get(input.id)!,
    inputRef: inputRefs.get(input.id)!,
    sessionId: input.sessionId,
    startAt: input.observedAt,
    endAt: next?.observedAt ?? null,
  };
}

function digestRef(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
