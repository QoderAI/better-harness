import assert from "node:assert/strict";
import test from "node:test";

async function populationModule() {
  return import("../scripts/session-analysis/session-population.mjs");
}

test("frozen population binding omits exact active and Qoder home-only sessions", async () => {
  const { freezeSessionPopulation } = await populationModule();
  const population = freezeSessionPopulation({
    scope: {
      platform: "qoder",
      workspace: "/private/workspace",
      since: "2026-07-01T00:00:00.000Z",
      until: "2026-07-30T00:00:00.000Z",
    },
    sessions: [
      { sessionId: "active-private", sourceRefs: [{ kind: "project-session", path: "/private/active.jsonl" }] },
      { sessionId: "home-private", sourceRefs: [{ kind: "home-session", path: "/private/home.jsonl" }] },
      { sessionId: "eligible-private", sourceRefs: [{ kind: "project-session", path: "/private/eligible.jsonl" }] },
    ],
    excludedSessionId: "active-private",
    suppliedUntil: true,
  });

  assert.deepEqual(population.sessions.map((session) => session.sessionId), ["eligible-private"]);
  assert.equal(population.binding.omission.activeSessions, 1);
  assert.equal(population.binding.omission.homeSessionOnly, 1);
  assert.equal(population.binding.omission.exactIdentityAvailable, true);
  assert.equal(population.binding.omission.recencyInference, "disabled-frozen-until");
  assert.equal(population.binding.eligible.count, 1);
  assert.match(population.binding.eligible.fingerprint, /^[a-f0-9]{16}$/u);
  assert.doesNotMatch(JSON.stringify(population.binding), /active-private|home-private|eligible-private|\/private/u);
});

test("selection binding rejects a session outside the frozen population", async () => {
  const { bindSessionSelection, freezeSessionPopulation } = await populationModule();
  const population = freezeSessionPopulation({
    scope: { platform: "codex", workspace: "/workspace", until: "2026-07-30T00:00:00.000Z" },
    sessions: [{ sessionId: "eligible" }],
    suppliedUntil: true,
  });

  assert.throws(
    () => bindSessionSelection(population, [{ sessionId: "foreign" }], {
      strategy: "stratified",
      projectionPolicy: "lead-report-signal-v1",
    }),
    (error) => error?.code === "SESSION_SELECTION_OUTSIDE_POPULATION",
  );
});

test("binding validation preserves zero-signal lead admission and reconciles Session facts", async () => {
  const {
    bindSessionSelection,
    freezeSessionPopulation,
    sessionAdmissionBinding,
    leadAdmissionBinding,
    validateSessionPopulationBundle,
  } = await populationModule();
  const population = freezeSessionPopulation({
    scope: { platform: "codex", workspace: "/workspace", until: "2026-07-30T00:00:00.000Z" },
    sessions: [{ sessionId: "eligible" }],
    suppliedUntil: true,
  });
  const sessionSelection = bindSessionSelection(population, population.sessions, {
    strategy: "all-eligible",
    projectionPolicy: "session-fact-candidates-v2",
  });
  const leadSelection = bindSessionSelection(population, population.sessions, {
    strategy: "stratified",
    projectionPolicy: "lead-report-signal-v1",
  });
  const sessionAdmission = sessionAdmissionBinding({
    admission: { taskEpisodes: 1, candidateEpisodes: 1, distinctRequests: 1, emittedCandidates: 1 },
    omitted: { noRequest: 0, selfAnalysis: 0, lowSignal: 0, duplicateRequests: 0, candidateBudget: 0 },
  }, sessionSelection);
  const leadAdmission = leadAdmissionBinding({
    projectedEpisodes: 1,
    admittedEpisodes: 0,
    zeroSignalDiscardedEpisodes: 1,
    retainedTaskEpisodes: 0,
  }, leadSelection);

  assert.deepEqual(validateSessionPopulationBundle({
    population: population.binding,
    session: { population: population.binding, selection: sessionSelection, admission: sessionAdmission },
    lead: { population: population.binding, selection: leadSelection, admission: leadAdmission },
  }), []);
});
