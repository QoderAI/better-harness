// LC-01 readiness contract (v1): frozen data only, no imports.
// Levels are independent contract values under a partial order; implementations
// must not introduce a numeric level ranking. Additions in later contract
// versions must not silently relax an existing level.

export const READINESS_CONTRACT_VERSION = 1;
export const DECISION_SCHEMA_VERSION = 1;
export const ASSESSMENT_KIND = "loop-readiness-assessment";
export const DECISION_KIND = "loop-readiness-decision";

export const READINESS_LEVELS = Object.freeze([
  "read-only-observation",
  "plan-only",
  "human-approved-apply",
  "scheduled-read-only",
  "scheduled-bounded-apply",
]);

export const CAPABILITY_STATES = Object.freeze([
  "available",
  "partial",
  "unavailable",
  "blocked",
  "failed",
]);

const OBSERVATION_CAPABILITIES = Object.freeze([
  "workspace-read",
  "evidence-source",
  "privacy-boundary",
]);

const MUTATION_CAPABILITIES = Object.freeze([
  "plan-artifact-write",
  "human-approval",
  "isolated-execution",
  "frozen-pre-state",
  "validation-route",
  "rollback-reference",
]);

const SCHEDULE_CAPABILITIES = Object.freeze([
  "schedule-trigger",
  "stop-condition",
  "triage-path",
  "budget-policy",
]);

export const CAPABILITY_IDS = Object.freeze([
  ...OBSERVATION_CAPABILITIES,
  ...MUTATION_CAPABILITIES,
  ...SCHEDULE_CAPABILITIES,
  "idempotent-recovery",
]);

export const REQUIRED_CAPABILITIES = Object.freeze({
  "read-only-observation": Object.freeze([...OBSERVATION_CAPABILITIES]),
  "plan-only": Object.freeze([...OBSERVATION_CAPABILITIES, "plan-artifact-write"]),
  "human-approved-apply": Object.freeze([
    ...OBSERVATION_CAPABILITIES,
    ...MUTATION_CAPABILITIES,
  ]),
  "scheduled-read-only": Object.freeze([
    ...OBSERVATION_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
  ]),
  "scheduled-bounded-apply": Object.freeze([
    ...OBSERVATION_CAPABILITIES,
    ...MUTATION_CAPABILITIES,
    ...SCHEDULE_CAPABILITIES,
    "idempotent-recovery",
  ]),
});
