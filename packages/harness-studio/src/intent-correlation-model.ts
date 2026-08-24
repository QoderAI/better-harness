export const INTENT_CORRELATION_PACKET_KIND = "IntentCorrelationPacketV1" as const;
export const INTENT_CORRELATION_ANALYSIS_KIND = "IntentCorrelationAnalysisV1" as const;

export type EvidenceStrength = "direct" | "observed" | "correlated" | "inferred";
export type ConfidenceLevel = "low" | "medium" | "high";
export type IntentClaimPredicate =
  | "creates" | "refines" | "constrains" | "clarifies" | "resumes" | "verifies" | "meta"
  | "implements" | "tests" | "documents" | "refactors" | "generated" | "incidental" | "preexisting"
  | "satisfies" | "partially-satisfies" | "conflicts" | "unverified";

export interface IntentInputEvidence {
  ref: string;
  sessionId: string;
  sliceRef: string;
  turnIndex: number;
  text: string;
  observedAt: string | null;
}

export interface IntentExecutionSliceEvidence {
  ref: string;
  inputRef: string;
  sessionId: string;
  startAt: string | null;
  endAt: string | null;
}

export interface IntentFileEvidence { ref: string; path: string }

export interface IntentChangeUnitEvidence {
  ref: string;
  fileRef: string;
  path: string;
  kind: "hunk" | "blob-delta" | "edit-target";
  changeState: "content-changed" | "edit-targeted";
  summary: string;
}

export interface IntentCommitEvidence { ref: string; sha: string; subject: string; observedAt?: string | null }
export interface IntentArtifactEvidence { ref: string; label: string; path?: string; mediaType?: string }
export interface IntentValidationEvidence { ref: string; label: string; outcome: "passed" | "failed" | "unknown" }

export interface IntentObservedEdge {
  ref: string;
  subjectRef: string;
  predicate: "contains" | "read" | "edit-targeted" | "content-changed" | "included-in" | "produced" | "validated-by" | "correlated-with";
  objectRef: string;
  strength: Exclude<EvidenceStrength, "inferred">;
  evidenceRefs: string[];
  limitations: string[];
}

export interface IntentCorrelationPacketV1 {
  kind: typeof INTENT_CORRELATION_PACKET_KIND;
  schemaVersion: 1;
  packetDigest: string;
  workspace: { label: string };
  inputs: IntentInputEvidence[];
  executionSlices: IntentExecutionSliceEvidence[];
  files: IntentFileEvidence[];
  changeUnits: IntentChangeUnitEvidence[];
  commits: IntentCommitEvidence[];
  artifacts: IntentArtifactEvidence[];
  validations: IntentValidationEvidence[];
  observedEdges: IntentObservedEdge[];
  allowedRefs: string[];
  limitations: string[];
}

export interface IntentProposal {
  id: string;
  title: string;
  summary: string;
  sourceRefs: string[];
  reviewStatus: "proposed";
}

export interface CorrelationClaim {
  id: string;
  subjectRef: string;
  predicate: IntentClaimPredicate;
  objectRef: string;
  evidenceRefs: string[];
  counterEvidenceRefs: string[];
  alternatives: Array<{ objectRef: string; reason: string }>;
  evidenceStrength: EvidenceStrength;
  confidence: {
    semanticFit: ConfidenceLevel;
    temporalFit: ConfidenceLevel;
    changeFit: ConfidenceLevel;
    acceptanceFit: ConfidenceLevel;
  };
  reason: string;
  limitations: string[];
  reviewStatus: "proposed";
}

export interface IntentCorrelationAnalysisV1 {
  kind: typeof INTENT_CORRELATION_ANALYSIS_KIND;
  schemaVersion: 1;
  packetDigest: string;
  intentProposals: IntentProposal[];
  claims: CorrelationClaim[];
  unassignedRefs: string[];
  unresolved: Array<{ id: string; question: string; evidenceRefs: string[] }>;
}

const CLAIM_PREDICATES = new Set<IntentClaimPredicate>([
  "creates", "refines", "constrains", "clarifies", "resumes", "verifies", "meta",
  "implements", "tests", "documents", "refactors", "generated", "incidental", "preexisting",
  "satisfies", "partially-satisfies", "conflicts", "unverified",
]);
const INPUT_PREDICATES = new Set<IntentClaimPredicate>(["creates", "refines", "constrains", "clarifies", "resumes", "verifies", "meta"]);
const CHANGE_PREDICATES = new Set<IntentClaimPredicate>(["implements", "tests", "documents", "refactors", "generated"]);
const CHANGE_RELATION_PREDICATES = new Set<IntentClaimPredicate>([...CHANGE_PREDICATES, "incidental", "preexisting"]);
const OUTCOME_PREDICATES = new Set<IntentClaimPredicate>(["satisfies", "partially-satisfies", "conflicts", "unverified"]);
const STRENGTH_RANK: Record<EvidenceStrength, number> = { inferred: 0, correlated: 1, observed: 2, direct: 3 };
const CONFIDENCE = new Set<ConfidenceLevel>(["low", "medium", "high"]);

export class IntentCorrelationContractError extends Error {}

export function validateIntentCorrelationAnalysis(packet: IntentCorrelationPacketV1, value: unknown): IntentCorrelationAnalysisV1 {
  const analysis = record(value, "analysis");
  exactKeys(analysis, ["kind", "schemaVersion", "packetDigest", "intentProposals", "claims", "unassignedRefs", "unresolved"], "analysis");
  equal(analysis.kind, INTENT_CORRELATION_ANALYSIS_KIND, "analysis.kind");
  equal(analysis.schemaVersion, 1, "analysis.schemaVersion");
  equal(analysis.packetDigest, packet.packetDigest, "analysis.packetDigest");
  rejectUnsafeShape(analysis, "analysis");

  const allowedRefs = new Set(packet.allowedRefs);
  const changeUnits = new Map(packet.changeUnits.map((unit) => [unit.ref, unit]));
  const edges = new Map(packet.observedEdges.map((edge) => [edge.ref, edge]));
  const proposalIds = new Set<string>();
  const intentProposals = array(analysis.intentProposals, "analysis.intentProposals", 200).map((candidate, index) => {
    const label = `analysis.intentProposals[${index}]`;
    const proposal = record(candidate, label);
    exactKeys(proposal, ["id", "title", "summary", "sourceRefs", "reviewStatus"], label);
    const id = boundedText(proposal.id, `${label}.id`, 240);
    if (!/^intent:proposed:[a-z0-9][a-z0-9._-]*$/u.test(id) || proposalIds.has(id)) fail(`${label}.id must be a unique stable proposed Intent ref.`);
    proposalIds.add(id);
    const sourceRefs = refs(proposal.sourceRefs, `${label}.sourceRefs`, allowedRefs, true);
    if (!sourceRefs.some((sourceRef) => sourceRef.startsWith("input:"))) fail(`${label}.sourceRefs must cite retained input evidence.`);
    equal(proposal.reviewStatus, "proposed", `${label}.reviewStatus`);
    return { id, title: boundedText(proposal.title, `${label}.title`, 120), summary: boundedText(proposal.summary, `${label}.summary`, 600), sourceRefs, reviewStatus: "proposed" as const };
  });
  if (packet.inputs.length > 0 && intentProposals.length === 0) fail("analysis.intentProposals must contain at least one proposal for a non-empty packet.");

  const claimRefs = new Set([...allowedRefs, ...proposalIds]);
  const claimIds = new Set<string>();
  const claims = array(analysis.claims, "analysis.claims", Math.max(32, allowedRefs.size * 4)).map((candidate, index) => {
    const label = `analysis.claims[${index}]`;
    const claim = record(candidate, label);
    exactKeys(claim, ["id", "subjectRef", "predicate", "objectRef", "evidenceRefs", "counterEvidenceRefs", "alternatives", "evidenceStrength", "confidence", "reason", "limitations", "reviewStatus"], label);
    const id = boundedText(claim.id, `${label}.id`, 240);
    if (!/^claim:[a-z0-9][a-z0-9._-]*$/u.test(id) || claimIds.has(id)) fail(`${label}.id must be a unique stable claim ref.`);
    claimIds.add(id);
    const subjectRef = ref(claim.subjectRef, `${label}.subjectRef`, claimRefs);
    const objectRef = ref(claim.objectRef, `${label}.objectRef`, claimRefs);
    if (!proposalIds.has(objectRef)) fail(`${label}.objectRef must identify a proposed Intent.`);
    if (!CLAIM_PREDICATES.has(claim.predicate as IntentClaimPredicate)) fail(`${label}.predicate is unsupported.`);
    const predicate = claim.predicate as IntentClaimPredicate;
    if (INPUT_PREDICATES.has(predicate) && !subjectRef.startsWith("input:")) fail(`${label}.${predicate} requires input evidence as its subject.`);
    if (CHANGE_RELATION_PREDICATES.has(predicate) && !subjectRef.startsWith("change:")) fail(`${label}.${predicate} requires change evidence as its subject.`);
    if (OUTCOME_PREDICATES.has(predicate) && !/^(?:validation|artifact|commit):/u.test(subjectRef)) fail(`${label}.${predicate} requires outcome evidence as its subject.`);
    const evidenceRefs = refs(claim.evidenceRefs, `${label}.evidenceRefs`, allowedRefs, true);
    if (!evidenceSupportsSubject(subjectRef, evidenceRefs, edges)) fail(`${label}.evidenceRefs must connect to its subjectRef.`);
    const counterEvidenceRefs = refs(claim.counterEvidenceRefs, `${label}.counterEvidenceRefs`, allowedRefs, false);
    const alternatives = array(claim.alternatives, `${label}.alternatives`, 16).map((candidateAlternative, alternativeIndex) => {
      const alternativeLabel = `${label}.alternatives[${alternativeIndex}]`;
      const alternative = record(candidateAlternative, alternativeLabel);
      exactKeys(alternative, ["objectRef", "reason"], alternativeLabel);
      const alternativeObjectRef = ref(alternative.objectRef, `${alternativeLabel}.objectRef`, claimRefs);
      if (!proposalIds.has(alternativeObjectRef)) fail(`${alternativeLabel}.objectRef must identify a proposed Intent.`);
      return { objectRef: alternativeObjectRef, reason: boundedText(alternative.reason, `${alternativeLabel}.reason`, 300) };
    });
    if (!(claim.evidenceStrength === "direct" || claim.evidenceStrength === "observed" || claim.evidenceStrength === "correlated" || claim.evidenceStrength === "inferred")) fail(`${label}.evidenceStrength is unsupported.`);
    const evidenceStrength = claim.evidenceStrength as EvidenceStrength;
    const strongest = evidenceRefs.reduce((rank, evidenceRef) => Math.max(rank, STRENGTH_RANK[edges.get(evidenceRef)?.strength ?? "observed"]), 0);
    if (STRENGTH_RANK[evidenceStrength] > strongest) fail(`${label}.evidenceStrength is stronger than its cited evidence.`);
    const confidence = record(claim.confidence, `${label}.confidence`);
    exactKeys(confidence, ["semanticFit", "temporalFit", "changeFit", "acceptanceFit"], `${label}.confidence`);
    const confidenceResult = {
      semanticFit: confidenceLevel(confidence.semanticFit, `${label}.confidence.semanticFit`),
      temporalFit: confidenceLevel(confidence.temporalFit, `${label}.confidence.temporalFit`),
      changeFit: confidenceLevel(confidence.changeFit, `${label}.confidence.changeFit`),
      acceptanceFit: confidenceLevel(confidence.acceptanceFit, `${label}.confidence.acceptanceFit`),
    };
    const limitations = texts(claim.limitations, `${label}.limitations`, 16, 500);
    if (limitations.length === 0) fail(`${label}.limitations must not be empty.`);
    equal(claim.reviewStatus, "proposed", `${label}.reviewStatus`);
    if (CHANGE_PREDICATES.has(predicate) && changeUnits.get(subjectRef)?.changeState === "edit-targeted") fail(`${label} cannot promote edit-targeted evidence with '${predicate}'.`);
    return { id, subjectRef, predicate, objectRef, evidenceRefs, counterEvidenceRefs, alternatives, evidenceStrength, confidence: confidenceResult, reason: boundedText(claim.reason, `${label}.reason`, 800), limitations, reviewStatus: "proposed" as const };
  });
  if (intentProposals.length > 0 && claims.length === 0) fail("analysis.claims must contain at least one evidence-backed claim.");

  const unassignedRefs = refs(analysis.unassignedRefs, "analysis.unassignedRefs", allowedRefs, false);
  const unresolved = array(analysis.unresolved, "analysis.unresolved", 200).map((candidate, index) => {
    const label = `analysis.unresolved[${index}]`;
    const question = record(candidate, label);
    exactKeys(question, ["id", "question", "evidenceRefs"], label);
    const id = boundedText(question.id, `${label}.id`, 240);
    if (!/^question:[a-z0-9][a-z0-9._-]*$/u.test(id)) fail(`${label}.id must use question:<stable-slug>.`);
    return { id, question: boundedText(question.question, `${label}.question`, 500), evidenceRefs: refs(question.evidenceRefs, `${label}.evidenceRefs`, allowedRefs, true) };
  });
  return { kind: INTENT_CORRELATION_ANALYSIS_KIND, schemaVersion: 1, packetDigest: packet.packetDigest, intentProposals, claims, unassignedRefs, unresolved };
}

function evidenceSupportsSubject(
  subjectRef: string,
  evidenceRefs: readonly string[],
  edges: ReadonlyMap<string, IntentObservedEdge>,
): boolean {
  return evidenceRefs.some((evidenceRef) => {
    if (evidenceRef === subjectRef) return true;
    const edge = edges.get(evidenceRef);
    return edge !== undefined
      && (edge.subjectRef === subjectRef || edge.objectRef === subjectRef || edge.evidenceRefs.includes(subjectRef));
  });
}

export function parseIntentCorrelationAnalysis(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu);
    if (fenced !== null) return JSON.parse(fenced[1]!.trim());
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new IntentCorrelationContractError("Intent analyzer did not return a JSON object.");
  }
}

export function isIntentCorrelationAnalysis(value: unknown): value is IntentCorrelationAnalysisV1 {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<IntentCorrelationAnalysisV1>;
  return candidate.kind === INTENT_CORRELATION_ANALYSIS_KIND && candidate.schemaVersion === 1
    && typeof candidate.packetDigest === "string" && Array.isArray(candidate.intentProposals)
    && Array.isArray(candidate.claims) && Array.isArray(candidate.unassignedRefs) && Array.isArray(candidate.unresolved);
}

function rejectUnsafeShape(value: unknown, label: string): void {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectUnsafeShape(item, `${label}[${index}]`));
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (/^(?:score|overallScore|confidenceScore)$/iu.test(key)) fail(`${label}.${key} is an unsupported aggregate score.`);
      rejectUnsafeShape(nested, `${label}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && (/^[A-Za-z]:[\\/]/u.test(value) || /^\\\\/u.test(value) || /^\/(?:Users|home|tmp|var|private|Volumes|mnt|opt)\//u.test(value))) fail(`${label} contains a native absolute path.`);
}

function refs(value: unknown, label: string, allowed: Set<string>, required: boolean): string[] {
  const values = texts(value, label, 256, 240);
  if (required && values.length === 0) fail(`${label} must cite evidence.`);
  for (const valueRef of values) ref(valueRef, label, allowed);
  return values;
}

function ref(value: unknown, label: string, allowed: Set<string>): string {
  const result = boundedText(value, label, 240);
  if (!allowed.has(result)) fail(`${label} uses unknown ref '${result}'.`);
  return result;
}

function confidenceLevel(value: unknown, label: string): ConfidenceLevel {
  if (!CONFIDENCE.has(value as ConfidenceLevel)) fail(`${label} is unsupported.`);
  return value as ConfidenceLevel;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} must be an array of at most ${maximum} items.`);
  return value;
}

function texts(value: unknown, label: string, maximum: number, itemMaximum: number): string[] {
  return array(value, label, maximum).map((item, index) => boundedText(item, `${label}[${index}]`, itemMaximum));
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(`${label} must be non-empty bounded text.`);
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(`${label} has unsupported fields.`);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) fail(`${label} is unsupported.`);
}

function fail(message: string): never {
  throw new IntentCorrelationContractError(`Intent correlation validation failed: ${message}`);
}
