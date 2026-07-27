export const LEARNING_LOOP_CHECK_IDS = Object.freeze([
  "lifecycle-repeat-detection",
  "loop-engineering",
  "later-validation",
]);

const STATE_DOMAINS = Object.freeze({
  "lifecycle-repeat-detection": new Set(["Missing", "Unobserved", "Present", "Wired", "Exercised"]),
  "loop-engineering": new Set(["Missing", "Unobserved", "Not applicable", "Present", "Wired", "Exercised"]),
  "later-validation": new Set(["Missing", "Unobserved", "Not applicable", "Present", "Wired", "Exercised", "Outcome-supported"]),
});

const POSITIVE_LOOP_ENGINEERING_STATES = new Set(["Present", "Wired", "Exercised"]);
const POSITIVE_LATER_VALIDATION_STATES = new Set(["Present", "Wired", "Exercised", "Outcome-supported"]);
const EVIDENCE_LEVELS = new Set(["Present", "Wired", "Exercised", "Outcome-supported"]);
const SCORE_CEILING_BY_STATE = Object.freeze({
  Missing: 59,
  Unobserved: 59,
  Present: 74,
  Wired: 84,
  Exercised: 94,
  "Outcome-supported": 100,
  "Not applicable": 94,
});

export function projectLaterValidationState(entries = [], { loopEngineeringState } = {}) {
  const ledger = Array.isArray(entries) ? entries : [];
  if (ledger.length === 0) {
    return loopEngineeringState === "Not applicable" ? "Not applicable" : null;
  }
  if (loopEngineeringState !== "Exercised") return "Unobserved";

  const states = ledger.map((entry) => entry?.result?.state).filter(Boolean);
  if (states.includes("regressing")) return "Exercised";
  if (states.includes("outcome-supported")) return "Outcome-supported";
  if (states.some((state) => ["improving", "unchanged"].includes(state))) return "Exercised";
  const pending = ledger.filter((entry) => entry?.result?.state === "pending");
  if (pending.some((entry) => entry?.comparisonWindow?.taskMix === "comparable")) return "Wired";
  if (pending.length > 0) return "Present";
  return null;
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return LEARNING_LOOP_CHECK_IDS
    .filter((id) => Object.hasOwn(value, id))
    .map((id) => {
      const row = value[id];
      return typeof row === "string" ? { id, state: row } : { ...row, id };
    });
}

function normalizedTuple(value) {
  const byId = new Map(rows(value).map((row) => [row?.id, row]));
  return Object.fromEntries(LEARNING_LOOP_CHECK_IDS.map((id) => {
    const row = byId.get(id);
    return [id, row?.state ?? row?.level];
  }));
}

export function learningLoopStateErrors(value, options = {}) {
  const checkRows = rows(value);
  const errors = [];
  const counts = new Map();
  for (const row of checkRows) {
    const id = row?.id;
    if (!LEARNING_LOOP_CHECK_IDS.includes(id)) {
      errors.push(`Learning Capture contains unsupported check: ${id ?? "<missing>"}`);
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const id of LEARNING_LOOP_CHECK_IDS) {
    const count = counts.get(id) ?? 0;
    if (count === 0) errors.push(`Learning Capture is missing check: ${id}`);
    if (count > 1) errors.push(`Learning Capture contains duplicate check: ${id}`);
  }

  const tuple = normalizedTuple(checkRows);
  for (const id of LEARNING_LOOP_CHECK_IDS) {
    const state = tuple[id];
    if (!STATE_DOMAINS[id].has(state)) {
      errors.push(`Learning Capture ${id}.state is invalid: ${state ?? "<missing>"}`);
    }
  }
  if (errors.length > 0) return errors;

  const detection = tuple["lifecycle-repeat-detection"];
  const engineering = tuple["loop-engineering"];
  const later = tuple["later-validation"];

  if (POSITIVE_LOOP_ENGINEERING_STATES.has(engineering) && detection !== "Exercised") {
    errors.push("Learning Capture loop-engineering requires lifecycle-repeat-detection to be Exercised");
  }
  if (engineering === "Not applicable" && detection !== "Exercised") {
    errors.push("Learning Capture loop-engineering may be Not applicable only after lifecycle-repeat-detection is Exercised");
  }
  if (POSITIVE_LATER_VALIDATION_STATES.has(later) && engineering !== "Exercised") {
    errors.push("Learning Capture later-validation requires loop-engineering to be Exercised");
  }
  if (later === "Not applicable" && engineering !== "Not applicable") {
    errors.push("Learning Capture later-validation may be Not applicable only when loop-engineering is Not applicable");
  }
  if (engineering === "Not applicable" && !new Set(["Not applicable", "Unobserved"]).has(later)) {
    errors.push("Learning Capture explicit no-candidate results require later-validation to be Not applicable without a ledger or Unobserved with dormant ledger continuity");
  }

  if (Object.hasOwn(options, "interventionLedger")) {
    const ledger = Array.isArray(options.interventionLedger) ? options.interventionLedger : [];
    const projectedLater = projectLaterValidationState(ledger, { loopEngineeringState: engineering });
    if (ledger.length > 0 && later !== projectedLater) {
      errors.push(`Learning Capture later-validation must be ${projectedLater} for the current Loop Engineering state and retained intervention ledger`);
    }
    if (ledger.length === 0 && engineering === "Not applicable" && later !== "Not applicable") {
      errors.push("Learning Capture later-validation must be Not applicable for an explicit no-candidate result without an intervention ledger");
    }
    if (ledger.length === 0 && POSITIVE_LATER_VALIDATION_STATES.has(later)) {
      errors.push(`Learning Capture later-validation ${later} requires a retained intervention ledger`);
    }
  }
  return errors;
}

export function assertValidLearningLoopStateTuple(value) {
  const errors = learningLoopStateErrors(value);
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join("; ")), {
      code: "INVALID_LEARNING_LOOP_STATE_TUPLE",
      errors,
    });
  }
  return normalizedTuple(value);
}

export function projectLearningLoopState(value) {
  const tuple = assertValidLearningLoopStateTuple(value);
  const detection = tuple["lifecycle-repeat-detection"];
  const engineering = tuple["loop-engineering"];
  const later = tuple["later-validation"];

  let state;
  if (engineering === "Exercised") {
    state = later === "Outcome-supported" ? "Outcome-supported" : "Exercised";
  } else if (engineering === "Wired" || engineering === "Present") {
    state = engineering;
  } else if (detection === "Exercised") {
    state = "Exercised";
  } else {
    state = detection;
  }

  return {
    state,
    level: EVIDENCE_LEVELS.has(state) ? state : null,
  };
}

export function learningCaptureScoreCeiling(value) {
  const tuple = assertValidLearningLoopStateTuple(value);
  const detection = tuple["lifecycle-repeat-detection"];
  const engineering = tuple["loop-engineering"];
  const later = tuple["later-validation"];

  if (detection !== "Exercised") return SCORE_CEILING_BY_STATE[detection] ?? 59;
  if (engineering === "Not applicable") return 94;
  if (engineering !== "Exercised") return SCORE_CEILING_BY_STATE[engineering] ?? 59;
  if (["Missing", "Unobserved", "Not applicable"].includes(later)) return 74;
  return SCORE_CEILING_BY_STATE[later] ?? 59;
}
