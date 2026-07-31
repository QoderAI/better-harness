// LC-01 readiness evaluator: pure assessment-in/decision-out, no I/O.
// Fail-closed boundary: a structurally valid assessment that misses a
// requirement is a `prevented` decision; anything the input contract rejects
// raises a typed ReadinessInputError and never becomes a decision.

import {
  ASSESSMENT_KIND,
  CAPABILITY_IDS,
  CAPABILITY_STATES,
  DECISION_KIND,
  DECISION_SCHEMA_VERSION,
  READINESS_CONTRACT_VERSION,
  READINESS_LEVELS,
  REQUIRED_CAPABILITIES,
} from "./contract.mjs";

export class ReadinessInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReadinessInputError";
    this.code = code;
  }
}

const ASSESSMENT_FIELDS = new Set(["kind", "readinessContractVersion", "observations"]);
const OBSERVATION_FIELDS = new Set(["id", "state", "evidence"]);

function fail(code, message) {
  throw new ReadinessInputError(code, message);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAssessment(assessment) {
  if (!isPlainObject(assessment)) {
    fail("MALFORMED_ASSESSMENT", "Assessment must be a JSON object.");
  }
  for (const field of Object.keys(assessment)) {
    if (!ASSESSMENT_FIELDS.has(field)) {
      fail("UNKNOWN_FIELD", `Unknown assessment field: ${field}.`);
    }
  }
  if (assessment.kind !== ASSESSMENT_KIND) {
    fail("MALFORMED_ASSESSMENT", `Assessment kind must be "${ASSESSMENT_KIND}".`);
  }
  if (assessment.readinessContractVersion !== READINESS_CONTRACT_VERSION) {
    fail(
      "UNSUPPORTED_CONTRACT_VERSION",
      `Unsupported readinessContractVersion: ${JSON.stringify(assessment.readinessContractVersion)}. ` +
        `This evaluator supports only version ${READINESS_CONTRACT_VERSION}.`,
    );
  }
  if (!Array.isArray(assessment.observations)) {
    fail("MALFORMED_ASSESSMENT", "Assessment observations must be an array (it may be empty).");
  }
  const seen = new Set();
  for (const observation of assessment.observations) {
    if (!isPlainObject(observation)) {
      fail("MALFORMED_ASSESSMENT", "Each observation must be a JSON object.");
    }
    for (const field of Object.keys(observation)) {
      if (!OBSERVATION_FIELDS.has(field)) {
        fail("UNKNOWN_FIELD", `Unknown observation field: ${field}.`);
      }
    }
    if (!CAPABILITY_IDS.includes(observation.id)) {
      // Strict rejection: a misspelled capability must not silently degrade
      // to `unavailable`.
      fail("UNKNOWN_CAPABILITY", `Unknown capability id: ${JSON.stringify(observation.id)}.`);
    }
    if (!CAPABILITY_STATES.includes(observation.state)) {
      fail(
        "UNKNOWN_STATE",
        `Unknown capability state for ${observation.id}: ${JSON.stringify(observation.state)}.`,
      );
    }
    if (typeof observation.evidence !== "string" || observation.evidence.trim() === "") {
      fail("EMPTY_EVIDENCE", `Observation ${observation.id} must carry a non-empty evidence string.`);
    }
    if (seen.has(observation.id)) {
      fail("DUPLICATE_OBSERVATION", `Capability ${observation.id} is observed more than once.`);
    }
    seen.add(observation.id);
  }
}

export function evaluateReadiness({ level, assessment }) {
  if (!READINESS_LEVELS.includes(level)) {
    fail(
      "UNKNOWN_LEVEL",
      `Unknown readiness level: ${JSON.stringify(level)}. Known levels: ${READINESS_LEVELS.join(", ")}.`,
    );
  }
  validateAssessment(assessment);

  const observed = new Map(assessment.observations.map((observation) => [observation.id, observation]));
  const blockingCapabilities = [];
  const observations = [];
  for (const id of REQUIRED_CAPABILITIES[level]) {
    const observation = observed.get(id);
    if (!observation) {
      // Fail closed: an absent required capability reports `unavailable`.
      blockingCapabilities.push({ id, state: "unavailable" });
      continue;
    }
    // Contract-known observations the level does not require are ignored and
    // never echoed; only consumed observations appear in the envelope.
    observations.push({ id: observation.id, state: observation.state, evidence: observation.evidence });
    if (observation.state !== "available") {
      blockingCapabilities.push({ id, state: observation.state });
    }
  }

  return {
    kind: DECISION_KIND,
    schemaVersion: DECISION_SCHEMA_VERSION,
    readinessContractVersion: READINESS_CONTRACT_VERSION,
    level,
    status: blockingCapabilities.length === 0 ? "allowed" : "prevented",
    blockingCapabilities,
    observations,
  };
}
