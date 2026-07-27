import { createHash } from "node:crypto";
import { LEARNING_LOOP_CHECK_IDS } from "../learning-loop-contract.mjs";

export const HARNESS_REVIEW_PACKET_SCHEMA_VERSION = 2;
const LEARNING_CAPTURE_CHECK_IDS = new Set(LEARNING_LOOP_CHECK_IDS);

const EVIDENCE_ARRAY_FIELDS = new Set([
  "evidenceRefs",
  "staticEvidence",
  "currentTruthRefs",
  "requiredStepRefs",
  "updateEvidenceRefs",
  "outcomeEvidenceRefs",
  "frictionRefs",
  "present",
  "wired",
  "episodeEvidence",
  "deliveryEvidence",
  "eventEvidenceRefs",
  "relatedEvidenceRefs",
  "sourceRefs",
  "boundedEvidenceRefs",
]);

function isEvidenceArrayField(field) {
  return EVIDENCE_ARRAY_FIELDS.has(field) || /EvidenceRefs$/u.test(field);
}

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

export function digestJson(value) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function evidenceKey(reference) {
  const kind = String(reference?.kind ?? "").trim();
  const id = String(reference?.id ?? "").trim();
  return kind && id ? `${kind}\u0000${id}` : "";
}

function publicEvidenceReference(reference) {
  const key = evidenceKey(reference);
  if (!key) return null;
  const value = {
    kind: String(reference.kind).trim(),
    id: String(reference.id).trim(),
  };
  for (const field of ["type", "status", "label", "line"]) {
    if (reference[field] !== undefined) value[field] = clone(reference[field]);
  }
  return value;
}

export function collectSourceEvidenceIndex(source) {
  const references = new Map();

  function visit(value, parentField = "") {
    if (Array.isArray(value)) {
      if (isEvidenceArrayField(parentField)) {
        for (const reference of value) {
          const publicReference = publicEvidenceReference(reference);
          if (publicReference) references.set(evidenceKey(publicReference), publicReference);
        }
      }
      for (const item of value) visit(item, parentField);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [field, child] of Object.entries(value)) visit(child, field);
  }

  visit(source);
  return [...references.values()].sort((left, right) => evidenceKey(left).localeCompare(evidenceKey(right)));
}

function requiredReviewContract(source) {
  const decisions = rows(source?.assessmentDecisions);
  const repository = decisions.find((decision) => decision?.kind === "repository-review") ?? {};
  const score = decisions.find((decision) => decision?.kind === "score-review") ?? {};
  const contract = {
    frameworks: rows(repository.requiredFrameworks),
    checks: rows(repository.requiredChecks),
    capabilities: rows(repository.requiredSoftwareFluencyCapabilities),
    dimensions: rows(score.dimensions).map((dimension) => dimension?.id).filter(Boolean),
  };
  if (repository.learningCaptureFindingPolicy !== undefined) {
    contract.learningCaptureFindingPolicy = repository.learningCaptureFindingPolicy;
  }
  return contract;
}

function packetDigestPayload(packet) {
  const { packetDigest: _packetDigest, ...payload } = packet ?? {};
  return payload;
}

export function harnessReviewPacketDigest(packet) {
  return digestJson(packetDigestPayload(packet));
}

export function buildHarnessReviewPacket(source) {
  const packet = {
    schemaVersion: HARNESS_REVIEW_PACKET_SCHEMA_VERSION,
    kind: "harness-report-review-packet",
    sourceDigest: digestJson(source),
    required: requiredReviewContract(source),
    allowedEnums: {
      scoreConfidence: ["low", "medium", "high"],
      learningCaptureState: ["Present", "Wired", "Exercised", "Outcome-supported", "Missing", "Unobserved", "Not applicable"],
      taskUnderstandingState: ["Exercised", "Unobserved", "Not applicable"],
    },
    allowedEvidenceRefs: collectSourceEvidenceIndex(source),
  };
  packet.packetDigest = harnessReviewPacketDigest(packet);
  return packet;
}

export function validateHarnessReviewPacket(source, packet) {
  const errors = [];
  if (packet?.schemaVersion !== HARNESS_REVIEW_PACKET_SCHEMA_VERSION) {
    errors.push(`review packet schemaVersion must be ${HARNESS_REVIEW_PACKET_SCHEMA_VERSION}`);
  }
  if (packet?.kind !== "harness-report-review-packet") errors.push("review packet kind is invalid");
  if (packet?.sourceDigest !== digestJson(source)) errors.push("review packet sourceDigest does not match the current source");
  if (packet?.packetDigest !== harnessReviewPacketDigest(packet)) errors.push("review packet digest does not match its content");
  const expected = buildHarnessReviewPacket(source);
  if (digestJson(packet?.required) !== digestJson(expected.required)) errors.push("review packet required ids do not match the current source");
  if (digestJson(packet?.allowedEnums) !== digestJson(expected.allowedEnums)) errors.push("review packet enum domains do not match the current contract");
  if (digestJson(packet?.allowedEvidenceRefs) !== digestJson(expected.allowedEvidenceRefs)) {
    errors.push("review packet evidence index does not match the current source");
  }
  return errors;
}

function requiredDecisionRows(ids, suppliedRows, label, errors) {
  const supplied = rows(suppliedRows);
  const expected = new Set(rows(ids));
  const counts = new Map();
  for (const row of supplied) {
    const id = String(row?.id ?? "");
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!expected.has(id)) errors.push(`${label} contains unknown id: ${id || "<missing>"}`);
  }
  const byId = new Map(supplied.map((row) => [String(row?.id ?? ""), row]));
  return rows(ids).map((id) => {
    const row = byId.get(id);
    if (!row) {
      errors.push(`${label} is missing required id: ${id}`);
      return { id, status: "reviewed", summary: "", evidenceRefs: [] };
    }
    if ((counts.get(id) ?? 0) > 1) errors.push(`${label} contains duplicate id: ${id}`);
    if (typeof row.summary !== "string" || row.summary.trim() === "") {
      errors.push(`${label}[${id}] requires summary`);
    }
    if (rows(row.evidenceRefs).length === 0) errors.push(`${label}[${id}] requires evidenceRefs`);
    const compiled = { ...clone(row), id, status: "reviewed" };
    if (LEARNING_CAPTURE_CHECK_IDS.has(id)) {
      if (!compiled.state) compiled.state = "Unobserved";
      if (!Array.isArray(compiled.findingRefs)) compiled.findingRefs = [];
      if (id === "loop-engineering" && !Array.isArray(compiled.mechanisms)) compiled.mechanisms = [];
    }
    return compiled;
  });
}

function requiredScoreRows(ids, suppliedRows, errors) {
  const label = "scoreReview.dimensions";
  const supplied = rows(suppliedRows);
  const expected = new Set(rows(ids));
  const counts = new Map();
  for (const row of supplied) {
    const id = String(row?.id ?? "");
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!expected.has(id)) errors.push(`${label} contains unknown id: ${id || "<missing>"}`);
  }
  const byId = new Map(supplied.map((row) => [String(row?.id ?? ""), row]));
  return rows(ids).map((id) => {
    const row = byId.get(id);
    if (!row) {
      errors.push(`${label} is missing required id: ${id}`);
      return { id, score: null, confidence: "", reason: "", readerSummary: "", evidenceRefs: [] };
    }
    if ((counts.get(id) ?? 0) > 1) errors.push(`${label} contains duplicate id: ${id}`);
    if (!Number.isInteger(row.score) || row.score < 0 || row.score > 100) {
      errors.push(`${label}[${id}] score must be an integer from 0 to 100`);
    }
    if (!["low", "medium", "high"].includes(row.confidence)) {
      errors.push(`${label}[${id}] confidence must be low, medium, or high`);
    }
    for (const field of ["reason", "readerSummary"]) {
      if (typeof row[field] !== "string" || row[field].trim() === "") errors.push(`${label}[${id}] requires ${field}`);
    }
    if (rows(row.evidenceRefs).length === 0) errors.push(`${label}[${id}] requires evidenceRefs`);
    return { ...clone(row), id };
  });
}

/** Compile the lead's judgment-only object into the full internal review shape. */
export function compileHarnessLeadDecision(source, packet, decisionInput) {
  const errors = [];
  const decision = decisionInput && typeof decisionInput === "object" && !Array.isArray(decisionInput)
    ? clone(decisionInput)
    : {};
  if (!decisionInput || typeof decisionInput !== "object" || Array.isArray(decisionInput)) {
    errors.push("lead decision must be one JSON object");
  }
  const sourceRefs = rows(decision?.sourceCandidate?.evidenceRefs);
  if (sourceRefs.length === 0) errors.push("sourceCandidate.evidenceRefs is required");
  if (!decision.readerOverview || typeof decision.readerOverview !== "object" || Array.isArray(decision.readerOverview)) {
    errors.push("readerOverview is required");
  } else {
    if (typeof decision.readerOverview.text !== "string" || decision.readerOverview.text.trim() === "") {
      errors.push("readerOverview.text is required");
    }
    if (rows(decision.readerOverview.evidenceRefs).length === 0) {
      errors.push("readerOverview.evidenceRefs is required");
    }
  }
  const review = {
    sourceDigest: packet?.sourceDigest,
    packetDigest: packet?.packetDigest,
    sourceCandidate: { evidenceRefs: clone(sourceRefs) },
    readerOverview: clone(decision.readerOverview ?? { text: "", evidenceRefs: [] }),
    repositoryReview: {
      reviewedFrameworks: requiredDecisionRows(
        packet?.required?.frameworks,
        decision?.repositoryReview?.reviewedFrameworks,
        "repositoryReview.reviewedFrameworks",
        errors,
      ),
      reviewedChecks: requiredDecisionRows(
        packet?.required?.checks,
        decision?.repositoryReview?.reviewedChecks,
        "repositoryReview.reviewedChecks",
        errors,
      ),
      reviewedSoftwareFluencyCapabilities: requiredDecisionRows(
        packet?.required?.capabilities,
        decision?.repositoryReview?.reviewedSoftwareFluencyCapabilities,
        "repositoryReview.reviewedSoftwareFluencyCapabilities",
        errors,
      ),
    },
    repositoryEvidence: clone(decision.repositoryEvidence ?? {}),
    scoreReview: {
      dimensions: requiredScoreRows(packet?.required?.dimensions, decision?.scoreReview?.dimensions, errors),
    },
    ...(decision.episodeReviews !== undefined ? { episodeReviews: clone(decision.episodeReviews) } : {}),
    ...(decision.deliveryReviews !== undefined ? { deliveryReviews: clone(decision.deliveryReviews) } : {}),
    ...(decision.interventionLedger !== undefined ? { interventionLedger: clone(decision.interventionLedger) } : {}),
  };
  errors.push(...validateHarnessReviewBinding(source, review, packet));
  return { review, errors: [...new Set(errors)].sort() };
}

function collectReviewEvidenceRefs(review) {
  const references = [];
  function visit(value, parentField = "") {
    if (Array.isArray(value)) {
      if (isEvidenceArrayField(parentField)) references.push(...value);
      for (const item of value) visit(item, parentField);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [field, child] of Object.entries(value)) visit(child, field);
  }
  visit(review);
  return references;
}

export function validateHarnessReviewBinding(source, review, packet) {
  const errors = validateHarnessReviewPacket(source, packet);
  if (review?.sourceDigest !== packet?.sourceDigest) errors.push("review sourceDigest does not match the review packet");
  if (review?.packetDigest !== packet?.packetDigest) errors.push("review packetDigest does not match the review packet");
  const allowed = new Set(rows(packet?.allowedEvidenceRefs).map(evidenceKey).filter(Boolean));
  for (const reference of collectReviewEvidenceRefs(review)) {
    const key = evidenceKey(reference);
    if (!key) {
      errors.push("review evidence refs must contain non-empty kind and id");
    } else if (!allowed.has(key)) {
      errors.push(`review evidence ref is not present in the source packet: ${reference.kind}:${reference.id}`);
    }
  }
  return [...new Set(errors)];
}
