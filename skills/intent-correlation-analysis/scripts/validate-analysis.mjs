#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const PACKET_KIND = "IntentCorrelationPacketV1";
const ANALYSIS_KIND = "IntentCorrelationAnalysisV1";
const COLLECTIONS = ["inputs", "executionSlices", "files", "changeUnits", "commits", "artifacts", "validations", "observedEdges"];
const PREFIXES = {
  inputs: "input:",
  executionSlices: "slice:",
  files: "file:",
  changeUnits: "change:",
  commits: "commit:",
  artifacts: "artifact:",
  validations: "validation:",
  observedEdges: "edge:",
};
const OBSERVED_PREDICATES = new Set(["contains", "read", "edit-targeted", "content-changed", "included-in", "produced", "validated-by", "correlated-with"]);
const CLAIM_PREDICATES = new Set(["creates", "refines", "constrains", "clarifies", "resumes", "verifies", "meta", "implements", "tests", "documents", "refactors", "generated", "incidental", "preexisting", "satisfies", "partially-satisfies", "conflicts", "unverified"]);
const INPUT_PREDICATES = new Set(["creates", "refines", "constrains", "clarifies", "resumes", "verifies", "meta"]);
const CHANGE_PREDICATES = new Set(["implements", "tests", "documents", "refactors", "generated"]);
const CHANGE_RELATION_PREDICATES = new Set([...CHANGE_PREDICATES, "incidental", "preexisting"]);
const OUTCOME_PREDICATES = new Set(["satisfies", "partially-satisfies", "conflicts", "unverified"]);
const STRENGTHS = new Set(["direct", "observed", "correlated", "inferred"]);
const CONFIDENCE = new Set(["low", "medium", "high"]);
const MAX_PACKET_BYTES = 1_000_000;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computePacketDigest(packet) {
  const { packetDigest: _ignored, ...digestible } = packet;
  return `sha256:${createHash("sha256").update(canonicalJson(digestible)).digest("hex")}`;
}

export function parseJsonPayload(text, label = "payload") {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu);
    if (fenced !== null) return JSON.parse(fenced[1].trim());
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error(`${label} is not a JSON object.`);
  }
}

export function validatePacket(packet) {
  object(packet, "packet");
  equal(packet.kind, PACKET_KIND, "packet.kind");
  equal(packet.schemaVersion, 1, "packet.schemaVersion");
  boundedText(packet.packetDigest, "packet.packetDigest", 80);
  if (!/^sha256:[0-9a-f]{64}$/u.test(packet.packetDigest)) fail("packet.packetDigest must be a sha256 digest.");
  const encoded = JSON.stringify(packet);
  if (Buffer.byteLength(encoded, "utf8") > MAX_PACKET_BYTES) fail(`packet exceeds ${MAX_PACKET_BYTES} bytes.`);
  rejectAbsolutePaths(packet, "packet");
  object(packet.workspace, "packet.workspace");
  boundedText(packet.workspace.label, "packet.workspace.label", 240);
  stringArray(packet.limitations, "packet.limitations", 64, 500);
  const allowedRefs = new Set(stringArray(packet.allowedRefs, "packet.allowedRefs", 20_000, 240));
  if (allowedRefs.size !== packet.allowedRefs.length) fail("packet.allowedRefs must not contain duplicates.");
  const entities = new Map();
  for (const collection of COLLECTIONS) {
    const values = array(packet[collection], `packet.${collection}`, collection === "observedEdges" ? 50_000 : 10_000);
    for (const [index, value] of values.entries()) {
      object(value, `packet.${collection}[${index}]`);
      const ref = boundedText(value.ref, `packet.${collection}[${index}].ref`, 240);
      if (!ref.startsWith(PREFIXES[collection])) fail(`${ref} must use the ${PREFIXES[collection]} prefix.`);
      if (entities.has(ref)) fail(`duplicate entity ref '${ref}'.`);
      entities.set(ref, { collection, value });
      if (!allowedRefs.has(ref)) fail(`entity ref '${ref}' is missing from allowedRefs.`);
      validateEntity(collection, value, `packet.${collection}[${index}]`);
    }
  }
  if (entities.size !== allowedRefs.size) fail("packet.allowedRefs may contain only declared entity refs.");
  for (const ref of allowedRefs) if (!entities.has(ref)) fail(`allowed ref '${ref}' has no declared entity.`);
  for (const [ref, entity] of entities) {
    if (entity.collection === "changeUnits") {
      const fileRef = requireRef(entity.value.fileRef, `${ref}.fileRef`, allowedRefs);
      if (entities.get(fileRef)?.collection !== "files") fail(`${ref}.fileRef must identify FileEvidence.`);
      continue;
    }
    if (entity.collection !== "observedEdges") continue;
    requireRef(entity.value.subjectRef, `${ref}.subjectRef`, allowedRefs);
    requireRef(entity.value.objectRef, `${ref}.objectRef`, allowedRefs);
    for (const evidenceRef of stringArray(entity.value.evidenceRefs, `${ref}.evidenceRefs`, 64, 240)) {
      requireRef(evidenceRef, `${ref}.evidenceRefs`, allowedRefs);
    }
  }
  equal(packet.packetDigest, computePacketDigest(packet), "packet.packetDigest canonical value");
  return { allowedRefs, entities };
}

function validateEntity(collection, value, label) {
  if (collection === "inputs") {
    boundedText(value.text, `${label}.text`, 1_500);
    boundedText(value.sessionId, `${label}.sessionId`, 240);
    boundedText(value.sliceRef, `${label}.sliceRef`, 240);
  } else if (collection === "executionSlices") {
    boundedText(value.inputRef, `${label}.inputRef`, 240);
    boundedText(value.sessionId, `${label}.sessionId`, 240);
  } else if (collection === "files") {
    portablePath(boundedText(value.path, `${label}.path`, 500), `${label}.path`);
  } else if (collection === "changeUnits") {
    boundedText(value.path, `${label}.path`, 500);
    portablePath(value.path, `${label}.path`);
    boundedText(value.fileRef, `${label}.fileRef`, 240);
    oneOf(value.kind, new Set(["hunk", "blob-delta", "edit-target"]), `${label}.kind`);
    oneOf(value.changeState, new Set(["content-changed", "edit-targeted"]), `${label}.changeState`);
    if (value.kind === "edit-target" && value.changeState !== "edit-targeted") fail(`${label} cannot promote an edit target to content changed.`);
  } else if (collection === "commits") {
    boundedText(value.sha, `${label}.sha`, 64);
    boundedText(value.subject, `${label}.subject`, 240);
  } else if (collection === "artifacts") {
    boundedText(value.label, `${label}.label`, 240);
    if (value.path !== undefined) portablePath(boundedText(value.path, `${label}.path`, 500), `${label}.path`);
  } else if (collection === "validations") {
    boundedText(value.label, `${label}.label`, 240);
    oneOf(value.outcome, new Set(["passed", "failed", "unknown"]), `${label}.outcome`);
  } else if (collection === "observedEdges") {
    oneOf(value.predicate, OBSERVED_PREDICATES, `${label}.predicate`);
    oneOf(value.strength, new Set(["direct", "observed", "correlated"]), `${label}.strength`);
    stringArray(value.limitations ?? [], `${label}.limitations`, 16, 500);
  }
}

export function validateAnalysis(packet, analysis) {
  const { allowedRefs, entities } = validatePacket(packet);
  object(analysis, "analysis");
  exactKeys(analysis, ["kind", "schemaVersion", "packetDigest", "intentProposals", "claims", "unassignedRefs", "unresolved"], "analysis");
  equal(analysis.kind, ANALYSIS_KIND, "analysis.kind");
  equal(analysis.schemaVersion, 1, "analysis.schemaVersion");
  equal(analysis.packetDigest, packet.packetDigest, "analysis.packetDigest");
  rejectAbsolutePaths(analysis, "analysis");
  rejectAggregateScores(analysis, "analysis");
  const proposals = array(analysis.intentProposals, "analysis.intentProposals", 200);
  const proposalIds = new Set();
  for (const [index, proposal] of proposals.entries()) {
    const label = `analysis.intentProposals[${index}]`;
    object(proposal, label);
    exactKeys(proposal, ["id", "title", "summary", "sourceRefs", "reviewStatus"], label);
    const id = boundedText(proposal.id, `${label}.id`, 240);
    if (!/^intent:proposed:[a-z0-9][a-z0-9._-]*$/u.test(id)) fail(`${label}.id must use intent:proposed:<stable-slug>.`);
    if (proposalIds.has(id)) fail(`duplicate Intent proposal '${id}'.`);
    proposalIds.add(id);
    boundedText(proposal.title, `${label}.title`, 120);
    boundedText(proposal.summary, `${label}.summary`, 600);
    equal(proposal.reviewStatus, "proposed", `${label}.reviewStatus`);
    const sources = stringArray(proposal.sourceRefs, `${label}.sourceRefs`, 64, 240);
    if (sources.length === 0) fail(`${label}.sourceRefs must cite packet evidence.`);
    for (const ref of sources) requireRef(ref, `${label}.sourceRefs`, allowedRefs);
    if (!sources.some((ref) => entities.get(ref)?.collection === "inputs")) fail(`${label}.sourceRefs must cite retained input evidence.`);
  }
  if (packet.inputs.length > 0 && proposals.length === 0) fail("analysis.intentProposals must contain at least one proposal for a non-empty packet.");
  const validClaimRefs = new Set([...allowedRefs, ...proposalIds]);
  const claims = array(analysis.claims, "analysis.claims", Math.max(32, allowedRefs.size * 4));
  const claimIds = new Set();
  for (const [index, claim] of claims.entries()) {
    const label = `analysis.claims[${index}]`;
    object(claim, label);
    exactKeys(claim, ["id", "subjectRef", "predicate", "objectRef", "evidenceRefs", "counterEvidenceRefs", "alternatives", "evidenceStrength", "confidence", "reason", "limitations", "reviewStatus"], label);
    const id = boundedText(claim.id, `${label}.id`, 240);
    if (!/^claim:[a-z0-9][a-z0-9._-]*$/u.test(id)) fail(`${label}.id must use claim:<stable-slug>.`);
    if (claimIds.has(id)) fail(`duplicate claim '${id}'.`);
    claimIds.add(id);
    requireRef(claim.subjectRef, `${label}.subjectRef`, validClaimRefs);
    requireRef(claim.objectRef, `${label}.objectRef`, validClaimRefs);
    if (!proposalIds.has(claim.objectRef)) fail(`${label}.objectRef must identify a proposed Intent.`);
    oneOf(claim.predicate, CLAIM_PREDICATES, `${label}.predicate`);
    if (INPUT_PREDICATES.has(claim.predicate) && !claim.subjectRef.startsWith("input:")) fail(`${label}.${claim.predicate} requires input evidence as its subject.`);
    if (CHANGE_RELATION_PREDICATES.has(claim.predicate) && !claim.subjectRef.startsWith("change:")) fail(`${label}.${claim.predicate} requires change evidence as its subject.`);
    if (OUTCOME_PREDICATES.has(claim.predicate) && !/^(?:validation|artifact|commit):/u.test(claim.subjectRef)) fail(`${label}.${claim.predicate} requires outcome evidence as its subject.`);
    oneOf(claim.evidenceStrength, STRENGTHS, `${label}.evidenceStrength`);
    equal(claim.reviewStatus, "proposed", `${label}.reviewStatus`);
    const evidenceRefs = stringArray(claim.evidenceRefs, `${label}.evidenceRefs`, 64, 240);
    if (evidenceRefs.length === 0) fail(`${label}.evidenceRefs must not be empty.`);
    for (const ref of evidenceRefs) requireRef(ref, `${label}.evidenceRefs`, allowedRefs);
    if (!evidenceSupportsSubject(claim.subjectRef, evidenceRefs, entities)) fail(`${label}.evidenceRefs must connect to its subjectRef.`);
    for (const ref of stringArray(claim.counterEvidenceRefs ?? [], `${label}.counterEvidenceRefs`, 64, 240)) requireRef(ref, `${label}.counterEvidenceRefs`, allowedRefs);
    array(claim.alternatives ?? [], `${label}.alternatives`, 16).forEach((alternative, alternativeIndex) => {
      object(alternative, `${label}.alternatives[${alternativeIndex}]`);
      const alternativeRef = requireRef(alternative.objectRef, `${label}.alternatives[${alternativeIndex}].objectRef`, validClaimRefs);
      if (!proposalIds.has(alternativeRef)) fail(`${label}.alternatives[${alternativeIndex}].objectRef must identify a proposed Intent.`);
      boundedText(alternative.reason, `${label}.alternatives[${alternativeIndex}].reason`, 300);
    });
    object(claim.confidence, `${label}.confidence`);
    exactKeys(claim.confidence, ["semanticFit", "temporalFit", "changeFit", "acceptanceFit"], `${label}.confidence`);
    for (const axis of ["semanticFit", "temporalFit", "changeFit", "acceptanceFit"]) oneOf(claim.confidence[axis], CONFIDENCE, `${label}.confidence.${axis}`);
    boundedText(claim.reason, `${label}.reason`, 800);
    const limitations = stringArray(claim.limitations, `${label}.limitations`, 16, 500);
    if (limitations.length === 0) fail(`${label}.limitations must state an evidence boundary.`);
    validateStrength(claim, evidenceRefs, entities, label);
    const subject = entities.get(claim.subjectRef);
    if (subject?.collection === "changeUnits" && CHANGE_PREDICATES.has(claim.predicate) && subject.value.changeState !== "content-changed") {
      fail(`${label} cannot use '${claim.predicate}' for edit-targeted evidence '${claim.subjectRef}'.`);
    }
  }
  if (proposals.length > 0 && claims.length === 0) fail("analysis.claims must contain at least one evidence-backed claim.");
  for (const ref of stringArray(analysis.unassignedRefs, "analysis.unassignedRefs", allowedRefs.size, 240)) requireRef(ref, "analysis.unassignedRefs", allowedRefs);
  const unresolved = array(analysis.unresolved, "analysis.unresolved", 200);
  for (const [index, question] of unresolved.entries()) {
    const label = `analysis.unresolved[${index}]`;
    object(question, label);
    exactKeys(question, ["id", "question", "evidenceRefs"], label);
    if (!/^question:[a-z0-9][a-z0-9._-]*$/u.test(boundedText(question.id, `${label}.id`, 240))) fail(`${label}.id must use question:<stable-slug>.`);
    boundedText(question.question, `${label}.question`, 500);
    const evidenceRefs = stringArray(question.evidenceRefs, `${label}.evidenceRefs`, 64, 240);
    if (evidenceRefs.length === 0) fail(`${label}.evidenceRefs must not be empty.`);
    for (const ref of evidenceRefs) requireRef(ref, `${label}.evidenceRefs`, allowedRefs);
  }
  return { intentProposalCount: proposals.length, claimCount: claims.length, unresolvedCount: unresolved.length };
}

function validateStrength(claim, evidenceRefs, entities, label) {
  const rank = { inferred: 0, correlated: 1, observed: 2, direct: 3 };
  let strongest = 0;
  for (const ref of evidenceRefs) {
    const entity = entities.get(ref);
    const strength = entity?.collection === "observedEdges" ? entity.value.strength : "observed";
    strongest = Math.max(strongest, rank[strength]);
  }
  if (rank[claim.evidenceStrength] > strongest) fail(`${label}.evidenceStrength is stronger than its cited evidence.`);
}

function evidenceSupportsSubject(subjectRef, evidenceRefs, entities) {
  return evidenceRefs.some((evidenceRef) => {
    if (evidenceRef === subjectRef) return true;
    const entity = entities.get(evidenceRef);
    if (entity?.collection !== "observedEdges") return false;
    return entity.value.subjectRef === subjectRef
      || entity.value.objectRef === subjectRef
      || entity.value.evidenceRefs.includes(subjectRef);
  });
}

function rejectAggregateScores(value, label) {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectAggregateScores(item, `${label}[${index}]`));
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (/^(?:score|overallScore|confidenceScore)$/iu.test(key)) fail(`${label}.${key} is an unsupported aggregate score.`);
    rejectAggregateScores(nested, `${label}.${key}`);
  }
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} keys must be exactly: ${expected.join(", ")}.`);
  }
}

function rejectAbsolutePaths(value, label) {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectAbsolutePaths(item, `${label}[${index}]`));
  if (value !== null && typeof value === "object") return Object.entries(value).forEach(([key, nested]) => rejectAbsolutePaths(nested, `${label}.${key}`));
  if (typeof value !== "string") return;
  if (/^[A-Za-z]:[\\/]/u.test(value) || /^\\\\/u.test(value) || /^\/(?:Users|home|tmp|var|private|Volumes|mnt|opt)\//u.test(value)) {
    fail(`${label} contains a native absolute path.`);
  }
}

function portablePath(value, label) {
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.includes("\\") || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(`${label} must be a repository-relative portable path.`);
  }
}

function requireRef(value, label, refs) {
  const ref = boundedText(value, label, 240);
  if (!refs.has(ref)) fail(`${label} uses unknown ref '${ref}'.`);
  return ref;
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function array(value, label, max) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  if (value.length > max) fail(`${label} exceeds ${max} items.`);
  return value;
}

function stringArray(value, label, max, itemMax) {
  return array(value, label, max).map((item, index) => boundedText(item, `${label}[${index}]`, itemMax));
}

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(`${label} must be non-empty bounded text (max ${max}).`);
  return value;
}

function oneOf(value, allowed, label) {
  if (!allowed.has(value)) fail(`${label} has unsupported value '${String(value)}'.`);
}

function equal(actual, expected, label) {
  if (actual !== expected) fail(`${label} must equal '${String(expected)}'.`);
}

function fail(message) {
  throw new Error(`Intent correlation validation failed: ${message}`);
}

async function main(argv) {
  if (argv[0] === "--packet" && argv.length === 2) {
    const packet = parseJsonPayload(await readFile(argv[1], "utf8"), "packet");
    validatePacket(packet);
    process.stdout.write(`${JSON.stringify({ ok: true, kind: PACKET_KIND, packetDigest: packet.packetDigest })}\n`);
    return;
  }
  if (argv.length !== 2) throw new Error("Usage: validate-analysis.mjs --packet <packet.json> | <packet.json> <analysis.json>");
  const packet = parseJsonPayload(await readFile(argv[0], "utf8"), "packet");
  const analysis = parseJsonPayload(await readFile(argv[1], "utf8"), "analysis");
  const receipt = validateAnalysis(packet, analysis);
  process.stdout.write(`${JSON.stringify({ ok: true, kind: ANALYSIS_KIND, packetDigest: packet.packetDigest, ...receipt })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
