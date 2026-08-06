import { createHash, randomUUID } from "node:crypto";

export const HOST_RUNTIME_KIND = "better-harness.host-runtime";
export const HOST_RUNTIME_SCHEMA_VERSION = 1;
export const SPECIALIST_LANES = Object.freeze([
  "sessionEvidence",
  "projectHarness",
  "agentCustomize",
]);

const LANE_LABELS = Object.freeze({
  sessionEvidence: "Session Evidence",
  projectHarness: "Project Harness",
  agentCustomize: "Agent Customize",
});

const LANE_STATUSES = new Set(["available", "partial", "unavailable"]);
const RESULT_STATUSES = new Set(["completed", "partial", "unavailable", "failed"]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function hashJson(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function assertObject(value, message, code = "INVALID_HOST_RUNTIME_CONTRACT") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(message), { code });
  }
}

function forbiddenKeys(value, path = "", found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => forbiddenKeys(entry, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:rawSession|rawSessions|rawTranscript|collectionReference|debugOutput|accessToken|refreshToken|apiKey|credential|secret)$/iu.test(key)) {
      found.push(`${path}.${key}`);
    }
    forbiddenKeys(child, `${path}.${key}`, found);
  }
  return found;
}

function laneInput(bundle, laneName) {
  const lane = bundle?.lanes?.[laneName];
  if (!lane || !LANE_STATUSES.has(lane.status)) {
    throw Object.assign(new Error(`invalid evidence lane: ${laneName}`), {
      code: "INVALID_EVIDENCE_LANE",
    });
  }
  const data = lane.data ?? null;
  const forbidden = forbiddenKeys(data, laneName);
  if (forbidden.length > 0) {
    throw Object.assign(new Error(`lane contains forbidden runtime fields: ${forbidden.join(", ")}`), {
      code: "FORBIDDEN_LANE_FIELDS",
    });
  }
  return {
    lane: laneName,
    label: LANE_LABELS[laneName],
    status: lane.status,
    input: clone(data),
    inputHash: hashJson(data),
  };
}

export function createRunPlan(bundle, options = {}) {
  assertObject(bundle, "evidence bundle is required");
  if (bundle.kind !== "better-harness.evidence-bundle") {
    throw Object.assign(new Error("host runtime requires an evidence bundle"), {
      code: "INVALID_EVIDENCE_BUNDLE_KIND",
    });
  }
  const context = clone(bundle.context ?? {});
  const lanes = Object.fromEntries(SPECIALIST_LANES.map((name) => [name, laneInput(bundle, name)]));
  const diagnostics = clone(bundle.diagnostics ?? {});
  const plan = {
    kind: HOST_RUNTIME_KIND,
    schemaVersion: HOST_RUNTIME_SCHEMA_VERSION,
    runId: options.runId ?? randomUUID(),
    createdAt: new Date().toISOString(),
    provider: context.provider,
    depth: context.depth,
    context,
    lanes,
    lead: clone(bundle.lead ?? null),
    diagnostics,
    expected: {
      laneCount: SPECIALIST_LANES.length,
      laneNames: [...SPECIALIST_LANES],
      independentContexts: true,
      readOnly: true,
    },
    executionPolicy: {
      normalBlocksOnPartial: context.depth === "normal",
      quickPreservesGaps: context.depth === "quick",
      maxSpecialists: SPECIALIST_LANES.length,
    },
  };
  return Object.freeze(plan);
}

export function validateRunPlan(plan) {
  assertObject(plan, "host runtime run plan is required");
  if (plan.kind !== HOST_RUNTIME_KIND || plan.schemaVersion !== HOST_RUNTIME_SCHEMA_VERSION) {
    throw Object.assign(new Error("unsupported host runtime run plan"), {
      code: "UNSUPPORTED_HOST_RUNTIME_SCHEMA",
    });
  }
  if (!Array.isArray(plan.expected?.laneNames)
    || plan.expected.laneCount !== SPECIALIST_LANES.length
    || plan.expected.laneNames.join("\0") !== SPECIALIST_LANES.join("\0")) {
    throw Object.assign(new Error("run plan does not require the three canonical lanes"), {
      code: "INVALID_RUN_PLAN_LANES",
    });
  }
  for (const laneName of SPECIALIST_LANES) {
    const lane = plan.lanes?.[laneName];
    if (!lane || lane.inputHash !== hashJson(lane.input)) {
      throw Object.assign(new Error(`run plan input hash mismatch for ${laneName}`), {
        code: "RUN_PLAN_INPUT_HASH_MISMATCH",
      });
    }
  }
  return plan;
}

function resultEntries(results) {
  if (Array.isArray(results)) return results;
  if (results && typeof results === "object") return Object.values(results);
  return [];
}

export function verifyRunResults(planInput, resultsInput) {
  const plan = validateRunPlan(planInput);
  const results = resultEntries(resultsInput);
  const errors = [];
  if (results.length !== SPECIALIST_LANES.length) {
    errors.push({ code: "SPECIALIST_COUNT_MISMATCH", message: "exactly three specialist results are required" });
  }
  const seenLanes = new Set();
  const seenContexts = new Set();
  const accepted = [];
  for (const result of results) {
    const resultErrors = [];
    if (!result || typeof result !== "object") {
      errors.push({ code: "INVALID_SPECIALIST_RESULT", message: "specialist result must be an object" });
      continue;
    }
    const lane = String(result.lane ?? "");
    const contextId = String(result.contextId ?? "");
    if (!SPECIALIST_LANES.includes(lane)) {
      errors.push({ code: "UNKNOWN_SPECIALIST_LANE", message: `unknown specialist lane: ${lane}` });
      continue;
    }
    if (seenLanes.has(lane)) resultErrors.push({ code: "DUPLICATE_SPECIALIST_LANE", message: lane });
    seenLanes.add(lane);
    if (!contextId) resultErrors.push({ code: "MISSING_SPECIALIST_CONTEXT", message: lane });
    if (contextId && seenContexts.has(contextId)) resultErrors.push({ code: "DUPLICATE_SPECIALIST_CONTEXT", message: contextId });
    if (contextId) seenContexts.add(contextId);
    if (result.inputHash !== plan.lanes[lane].inputHash) {
      resultErrors.push({ code: "SPECIALIST_INPUT_HASH_MISMATCH", message: lane });
    }
    if (!RESULT_STATUSES.has(result.status)) {
      resultErrors.push({ code: "INVALID_SPECIALIST_STATUS", message: lane });
    }
    const forbidden = forbiddenKeys(result.output ?? null, `${lane}.output`);
    if (forbidden.length > 0) {
      resultErrors.push({ code: "FORBIDDEN_SPECIALIST_FIELDS", message: forbidden.join(", ") });
    }
    if (!result.output || typeof result.output !== "object" || Array.isArray(result.output)) {
      resultErrors.push({ code: "INVALID_SPECIALIST_OUTPUT", message: lane });
    }
    if (result.resultHash !== undefined && result.resultHash !== hashJson(result.output)) {
      resultErrors.push({ code: "SPECIALIST_RESULT_HASH_MISMATCH", message: lane });
    }
    errors.push(...resultErrors);
    if (resultErrors.length === 0) {
      accepted.push({
        lane,
        contextId,
        status: result.status,
        inputHash: result.inputHash,
        output: clone(result.output),
        resultHash: result.resultHash ?? hashJson(result.output),
      });
    }
  }
  for (const lane of SPECIALIST_LANES) {
    if (!seenLanes.has(lane)) errors.push({ code: "MISSING_SPECIALIST_LANE", message: lane });
  }
  const incomplete = accepted.filter((result) => result.status !== "completed").map((result) => result.lane);
  if (plan.executionPolicy.normalBlocksOnPartial && incomplete.length > 0) {
    errors.push({ code: "NORMAL_RUN_HAS_INCOMPLETE_SPECIALIST", message: incomplete.join(", ") });
  }
  const ok = errors.length === 0 || (
    plan.depth === "quick"
    && errors.every((error) => ["NORMAL_RUN_HAS_INCOMPLETE_SPECIALIST"].includes(error.code))
    && accepted.length === SPECIALIST_LANES.length
  );
  return {
    ok,
    kind: HOST_RUNTIME_KIND,
    schemaVersion: HOST_RUNTIME_SCHEMA_VERSION,
    runId: plan.runId,
    provider: plan.provider,
    depth: plan.depth,
    results: accepted,
    diagnostics: {
      expectedContextCount: SPECIALIST_LANES.length,
      observedContextCount: seenContexts.size,
      incompleteLanes: incomplete,
      errors,
      confidence: incomplete.length > 0 ? "low" : "normal",
    },
  };
}

export { LANE_LABELS };
