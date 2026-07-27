import assert from "node:assert/strict";
import test from "node:test";

import {
  projectInterventionLedger,
  restoreProjectedInterventionLedger,
  summarizeLearningCapture,
  validateInterventionLedger,
} from "../scripts/harness-analysis/intervention-ledger.mjs";

function ref(id) {
  return { kind: "fixture", id };
}

function entry({
  id = "rule-1",
  state = "pending",
  taskMix = "unverified",
  selectionStrategy = "all-eligible",
  primaryValue,
  guardrailValue,
  effectiveness,
  outcomeEvidenceRefs,
  assetType = "rule",
} = {}) {
  return {
    id,
    schemaVersion: 1,
    frictionRefs: [ref("repeated-rework")],
    candidateCauses: [
      { kind: "harness", state: "candidate", evidenceRefs: [ref("missing-rule")] },
      { kind: "requirements", state: "candidate", evidenceRefs: [ref("ambiguous-request")] },
    ],
    asset: { type: assetType, label: "Minimal durable move" },
    owner: "repository-maintainer",
    baseline: {
      windowRef: "week-1",
      primaryValue: 8,
      guardrailValue: 0.1,
      evidenceRefs: [ref("week-1")],
    },
    primaryMetric: { id: "rework-rate", direction: "lower-is-better", unit: "ratio" },
    guardrailMetric: { id: "false-positive-rate", direction: "lower-is-better", unit: "ratio" },
    comparisonWindow: {
      laterWindowRef: "week-2",
      scope: "same change type and owner boundary",
      taskMix,
      selectionStrategy,
    },
    validation: { method: "compare redacted task episodes", evidenceRefs: [ref("comparison-method")] },
    stopOrRevertCondition: "Remove the rule if the guardrail worsens.",
    result: {
      state,
      ...(state === "pending" ? {} : {
        primaryValue,
        guardrailValue,
        evidenceRefs: [ref("week-2")],
        ...(outcomeEvidenceRefs ? { outcomeEvidenceRefs } : {}),
        ...(effectiveness ? { effectiveness } : {}),
      }),
    },
  };
}

test("pending interventions declare a falsifiable comparison without claiming effectiveness", () => {
  const pending = entry();
  assert.deepEqual(validateInterventionLedger([pending]), []);

  const learning = summarizeLearningCapture([pending]);
  assert.equal(learning.state, "pending");
  assert.equal(learning.effectiveness, undefined);
  assert.equal(learning.interventions[0].comparison.valid, false);
});

test("a comparable outcome-supported window is the only path to Effective", () => {
  const supportedOnly = entry({
    state: "outcome-supported",
    taskMix: "comparable",
    selectionStrategy: "stratified",
    primaryValue: 4,
    guardrailValue: 0.08,
    outcomeEvidenceRefs: [ref("ci-accepted")],
  });
  const effective = entry({
    state: "outcome-supported",
    taskMix: "comparable",
    selectionStrategy: "stratified",
    primaryValue: 4,
    guardrailValue: 0.08,
    outcomeEvidenceRefs: [ref("ci-accepted")],
    effectiveness: "Effective",
  });

  const supportedLearning = summarizeLearningCapture([supportedOnly]);
  assert.equal(supportedLearning.state, "outcome-supported");
  assert.equal(supportedLearning.effectiveness, undefined);
  assert.match(supportedLearning.summary, /effectiveness is not claimed/i);
  assert.deepEqual(validateInterventionLedger([effective]), []);
  const learning = summarizeLearningCapture([effective]);
  assert.equal(learning.state, "outcome-supported");
  assert.equal(learning.effectiveness, "Effective");
  assert.equal(learning.interventions[0].comparison.valid, true);
  assert.equal(learning.interventions[0].comparison.effectiveness, "Effective");
});

test("a retained ledger is dormant until current Loop Engineering is Exercised", () => {
  const historical = entry({
    state: "outcome-supported",
    taskMix: "comparable",
    selectionStrategy: "stratified",
    primaryValue: 4,
    guardrailValue: 0.08,
    outcomeEvidenceRefs: [ref("ci-accepted")],
    effectiveness: "Effective",
  });

  const learning = summarizeLearningCapture([historical], { active: false });
  assert.equal(learning.state, "N/A");
  assert.equal(learning.effectiveness, undefined);
  assert.match(learning.summary, /retained but dormant/i);
  assert.equal(learning.interventions[0].comparison.effectiveness, "Effective");
});

test("regression wins aggregate precedence without deleting valid historical comparison evidence", () => {
  const outcome = entry({
    id: "rule-outcome",
    state: "outcome-supported",
    taskMix: "comparable",
    selectionStrategy: "stratified",
    primaryValue: 4,
    guardrailValue: 0.08,
    outcomeEvidenceRefs: [ref("ci-accepted")],
    effectiveness: "Effective",
  });
  const regression = entry({
    id: "rule-regression",
    state: "regressing",
    taskMix: "comparable",
    selectionStrategy: "all-eligible",
    primaryValue: 10,
    guardrailValue: 0.1,
  });

  assert.deepEqual(validateInterventionLedger([outcome, regression]), []);
  const learning = summarizeLearningCapture([outcome, regression]);
  assert.equal(learning.state, "regressing");
  assert.equal(learning.effectiveness, undefined);
  assert.equal(learning.interventions.find((item) => item.id === "rule-outcome").comparison.effectiveness, "Effective");
});

test("ledger rejects pseudo-effective claims and a worsening guardrail", () => {
  const incomparable = entry({
    state: "outcome-supported",
    primaryValue: 4,
    guardrailValue: 0.08,
    outcomeEvidenceRefs: [ref("ci-accepted")],
    effectiveness: "Effective",
  });
  const regressingGuardrail = entry({
    state: "improving",
    taskMix: "comparable",
    selectionStrategy: "stratified",
    primaryValue: 4,
    guardrailValue: 0.2,
  });
  const latestN = entry({
    state: "improving",
    taskMix: "comparable",
    selectionStrategy: "latest-n",
    primaryValue: 4,
    guardrailValue: 0.08,
  });

  const incomparableErrors = validateInterventionLedger([incomparable]);
  const guardrailErrors = validateInterventionLedger([regressingGuardrail]);
  const latestNErrors = validateInterventionLedger([latestN]);
  assert.ok(incomparableErrors.some((error) => /needs comparable before\/after windows/i.test(error)));
  assert.ok(guardrailErrors.some((error) => /without worsening the guardrail/i.test(error)));
  assert.ok(latestNErrors.some((error) => /selectionStrategy must be all-eligible or stratified/i.test(error)));
});

test("reader projection preserves a validated ledger for the next report run", () => {
  const pending = entry({ assetType: "memory" });
  const projected = projectInterventionLedger([pending]).entries;
  const restored = restoreProjectedInterventionLedger(projected);

  assert.deepEqual(restored, [pending]);
  assert.deepEqual(validateInterventionLedger(restored), []);
});

test("Learning Capture interventions accept model-owned durable learning surfaces", () => {
  for (const assetType of ["memory", "repository-knowledge", "eval"]) {
    assert.deepEqual(validateInterventionLedger([entry({ assetType })]), []);
  }
});

test("intervention ledger rejects private identities, paths, credentials, and duplicate ids", () => {
  const privateEntry = entry();
  privateEntry.owner = "person@example.test";
  privateEntry.frictionRefs = [{ kind: "fixture", id: "private-ref", sessionId: "session-private" }];
  privateEntry.baseline.evidenceRefs = [{ kind: "fixture", path: "/Users/example/private/report.json" }];
  // secret-scan: allow -- synthetic invalid-domain credential fixture.
  privateEntry.stopOrRevertCondition = "Stop and call https://user:password@service.invalid when the guardrail worsens.";

  const errors = validateInterventionLedger([privateEntry]);

  assert.ok(errors.some((error) => /reader-safe role identifier/.test(error)));
  assert.ok(errors.some((error) => /private session id/.test(error)));
  assert.ok(errors.some((error) => /absolute or traversal path/.test(error)));
  assert.ok(errors.some((error) => /credential-shaped value/.test(error)));
  assert.ok(validateInterventionLedger([entry(), entry()]).some((error) => /ids must be unique/.test(error)));
});

test("intervention ledger rejects embedded cross-platform paths and centrally detected credentials", () => {
  for (const privatePath of [
    "Restore the baseline from /Users/example/private/report.json before comparing.",
    String.raw`Restore the baseline from C:\Users\example\private\report.json before comparing.`,
    String.raw`Restore the baseline from \\private-server\team-share\report.json before comparing.`,
  ]) {
    const privateEntry = entry();
    privateEntry.stopOrRevertCondition = privatePath;
    assert.ok(
      validateInterventionLedger([privateEntry]).some((error) => /absolute or traversal path/.test(error)),
      `expected a private path rejection for ${privatePath.slice(0, 24)}`,
    );
  }

  const credentialEntry = entry();
  credentialEntry.stopOrRevertCondition = `Rotate sk_live_${"A3b7C9d2".repeat(3)} before the next window.`;
  assert.ok(
    validateInterventionLedger([credentialEntry]).some((error) => /credential-shaped value/.test(error)),
  );
});
