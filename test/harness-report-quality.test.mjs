import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateHarnessCanvasQuality,
  evaluateHarnessReportQuality,
} from "../scripts/harness-analysis/report-quality.mjs";

const requiredSections = [
  "Executive Verdict",
  "Evidence Boundary",
  "Risk Findings",
  "Readiness Scorecard",
  "Signals And Diagnosis",
  "Action Pathways",
  "Unverified Items",
];

const richAiFixPrompt = String.raw`/better-harness fix this issue\n\nThe Canvas runtime under /tmp/fixture-project is missing preview health and module-load validation. Add the runtime validation path while keeping generated eval artifacts untouched.\n\n## Validation\n\n- Run node scripts/harness-analysis/validate-canvas.mjs --canvas insights.canvas.tsx\n- Confirm preview health and module load pass`;
const richSkillHandoffPrompt = "Use the create-skill workflow to extend the project release-smoke Skill. Target: /tmp/fixture-project/.qoder/skills/release-smoke/SKILL.md Finding: R1 Runtime unverified Evidence: report-quality gate Action: add the missing validation trigger and failure boundary Acceptance: the Skill tells the next agent when and how to run the smoke Validation: node --test test/better-harness-skill.test.mjs Risk boundary: do not add a new automation Safety note: do not modify unrelated skills";
const richScheduleHandoffPrompt = "/schedule create a recurring harness follow-up. Target: /tmp/fixture-project Finding: AIA-SCHEDULE-001 Low score follow-up Evidence: latest insights.canvas.tsx shows Readiness score 42/100 Action: run /better-harness weekly using the same language and output mode Acceptance: a new .qoder/better-harness run directory is created and the score is compared with the previous run Validation: node scripts/harness-analysis/validate-canvas.mjs --canvas <run>/insights.canvas.tsx Risk boundary: only write Better Harness report artifacts Safety note: do not modify generated eval artifacts Stop condition: stop when score is >= 60, no High/Now findings remain for two runs, or after four runs";
const richLoopScheduleHandoffPrompt = "/schedule create a recurring harness Loop Discovery follow-up. Target: /tmp/fixture-project Finding: AIA-LOOP-001 Validation entropy loop Evidence: Loop Discovery schedule-ready outcome in report Action: run /better-harness weekly with the same output mode and compare loopDiscovery status Acceptance: a new .qoder/better-harness run directory records whether the loop is covered Validation: node scripts/harness-analysis/validate-canvas.mjs --canvas <run>/insights.canvas.tsx Risk boundary: only write Better Harness report artifacts Safety note: do not modify source files or expose secrets Stop condition: stop when Loop Discovery reports covered for two runs or after four runs";

test("harness report quality flags small-sample reports that flatten high-impact risk", () => {
  const report = `# Report

- Analysis mode: small-sample

## Executive Verdict

Everything else is at L3 or reachable with low-effort fixes.

## Evidence Boundary

Only AGENTS.md, build.gradle, CI, and justfile were inspected.

## Readiness Scorecard

| Dimension | Level | Confidence | Main gap |
| --- | --- | --- | --- |
| Project Harness | L3 | Medium | no runtime |

## Action Pathways

1. Add CI check (P0)
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /small-sample framing/i.test(error)));
  assert.ok(quality.errors.some((error) => /missing section.*Risk Findings/i.test(error)));
  assert.ok(quality.errors.some((error) => /small-sample.*low-effort/i.test(error)));
  assert.ok(quality.errors.some((error) => /incident-style priority/i.test(error)));
  assert.ok(quality.errors.some((error) => /risk field.*pass check/i.test(error)));
});

test("harness report quality accepts risk-rich static evidence reports", () => {
  const report = `# Better Harness Readiness Report

- Analysis mode: static-only evidence-pack

## Project Overview

Fixture project: a static evidence report fixture. Primary language:
TypeScript. Source scale: 12 source files, 240 source lines. AGENTS.md:
1 tracked instruction file, status adequate.

## Executive Verdict

Readiness score is 54/100; higher confidence is not proven because runtime,
compatibility, security, release, and governance paths remain unverified.

## Evidence Boundary

Static evidence pack only; runtime and CI were not inspected.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| High | Runtime unverified | Browser SDK runtime | All browser payment flows | Unverified high-impact | static-only -> no browser smoke -> runtime unknown | Payment flow regression can ship | Run browser smoke and cite output |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Change Confidence | 42 | Low | tests exist | nothing executed |
| AI Readiness | 38 | Low | agent assets were not inspected | AI delivery evidence absent |

## Signals And Diagnosis

### Change Confidence
- Observed: tests exist.
- Diagnosis: feedback path is present.
- Missing or weak: nothing was executed.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Runtime Confidence Gate | runtime unverified | run browser smoke | output is cited | owner | Now | test log | High |

## Unverified Items

- CI status.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
  assert.equal(quality.summary.requiredSections, requiredSections.length);
  assert.equal(quality.summary.projectOverview, true);
});

test("harness report quality accepts compact final report sections", () => {
  const report = `# Better Harness Readiness Report

- Score model: Readiness score = 58, confidence Medium; static/local evidence, no runnable validation path observed
- AI Agent practice scope: inspected Rules and Skills; execution evidence out of scope.

## Project Overview

Fixture project: static evidence report. Primary language: TypeScript. Source
scale: 12 source files, 240 source lines. AGENTS.md: 1 tracked instruction file.

## Harness Dimensions

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Engineering Implementation | 62 | Medium | source/test structure is clear | no runtime validation executed |
| Validation & CI | 55 | Medium | package scripts name tests | CI result not observed |
| Release & Governance | 48 | Medium | release notes exist | publish gate unverified |
| AI Agent Practices | 54 | Medium | Rules and Skills were inspected | no observed repeated workflow |
| AI Readiness | 52 | Medium | agent rules mention validation | session evidence absent |

## Issue Findings

### Engineering Implementation

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check | Timing | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Runtime validation not observed | Validation path | Generated readiness claims | Static evidence | static scan -> no command run -> runtime unknown | Readers may trust unverified results | Run the named validation command and cite output | Next | Medium |

### AI Agent Practices

- Rules and Skills are present as inspected surfaces; execution evidence remains absent.

## Next Recommendations

| Recommendation | Timing | Impact | Pass check |
| --- | --- | --- | --- |
| Run focused validation and update the report evidence boundary | Next | Medium | Command output is cited |

## Notes And Method

- Evidence boundary: static file inspection only; no tests, CI, runtime, or UI checks were executed.
- Score caveat: score is capped below 75 by the validation-path gate.
- Generated artifacts: report.md and findings.json.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.equal(quality.summary.reportShape, "compact");
  assert.equal(quality.summary.requiredSections, 5);
  assert.deepEqual(quality.summary.missingSections, []);
  assert.equal(quality.summary.aiReadinessDimension, true);
});

test("harness report quality accepts style framing without visible AI Readiness score row", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 54/100.

## Evidence Boundary

Static evidence pack only.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Runtime unverified | Harness | Generated reports | Static evidence | report -> no runtime check | User may trust unverified results | Run smoke check |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Change Confidence | 42 | Low | tests exist | nothing executed |

## Signals And Diagnosis

Static docs are present, but validation is absent.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Validation path | no runnable validation path | add focused command mapping | command is cited | maintainer | Now | package script or CI config | High |

## Unverified Items

- Executed tests.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness report quality flags advanced scores without validation paths", () => {
  const report = `# Better Harness Readiness Report

- Score model: better_harness_score_0_100 = 82, confidence Medium

## Executive Verdict

Readiness verdict: L4 because agent instructions and workflow docs are rich.

## Evidence Boundary

Static evidence only; no runnable validation path observed. No project build, test, CI, runtime, or UI validation was executed.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Validation absent | Change confidence | Generated report may overclaim readiness | Confirmed report gap | static scan -> no executable path -> high score | Readers may trust unverified readiness | Identify a runnable validation path |

## Readiness Scorecard

| Dimension | Level | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Change Confidence | L4 | Medium | workflow docs | no executable validation |

## Signals And Diagnosis

Static docs are present, but validation is absent.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Validation path | no runnable validation path | add focused command mapping | command is cited | maintainer | Now | package script or CI config | High |

## Unverified Items

- Executed tests.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.equal(quality.summary.noValidationPath, true);
  assert.ok(quality.errors.some((error) => /high score requires/i.test(error)));
});

test("harness report quality accepts capped static score without validation paths", () => {
  const report = `# Better Harness Readiness Report

- Score model: Readiness score = 68, confidence Medium; static/local evidence, no runnable validation path observed

## Executive Verdict

Readiness score is capped at 68/100 because no runnable validation path was observed.

## Evidence Boundary

Static evidence only; no runnable validation path observed.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Validation absent | Change confidence | Generated report may overclaim readiness | Confirmed report gap | static scan -> no executable path -> capped score | Readers may miss validation risk | Identify a runnable validation path |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Change Confidence | 68 | Medium | workflow docs | no executable validation |
| AI Readiness | 58 | Medium | workflow docs mention AI use | no observed agent workflow |

## Signals And Diagnosis

Static docs are present, but validation is absent.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Validation path | no runnable validation path | add focused command mapping | command is cited | maintainer | Now | package script or CI config | High |

## Unverified Items

- Executed tests.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.equal(quality.summary.noValidationPath, true);
  assert.deepEqual(quality.errors, []);
});

test("harness report quality requires schedule handoff for low headline scores", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 42/100 until runtime and AI delivery evidence are verified.

## Evidence Boundary

Static evidence only; runtime and CI were not inspected.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| High | Runtime unverified | Browser SDK runtime | All generated reports | Confirmed static gap | static-only -> no preview smoke -> runtime unknown | Broken reports may be trusted | Run browser smoke and cite output |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Change Confidence | 42 | Low | tests exist | nothing executed |
| AI Readiness | 38 | Low | agent assets were not inspected | AI delivery evidence absent |

## Signals And Diagnosis

Engineering Implementation: static feedback exists, but execution evidence is absent.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Runtime Confidence Gate | runtime unverified | run browser smoke | output is cited | maintainer | Now | test log | High |

## Unverified Items

- CI status.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /low-score.*schedule/i.test(error)));
});

test("harness report quality accepts low scores with a schedule follow-up handoff", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 42/100 until runtime and AI delivery evidence are verified.

## Evidence Boundary

Static evidence only; runtime and CI were not inspected.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| High | Runtime unverified | Browser SDK runtime | All generated reports | Confirmed static gap | static-only -> no preview smoke -> runtime unknown | Broken reports may be trusted | Run browser smoke and cite output |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Change Confidence | 42 | Low | tests exist | nothing executed |
| AI Readiness | 38 | Low | agent assets were not inspected | AI delivery evidence absent |

## Signals And Diagnosis

Engineering Implementation: static feedback exists, but execution evidence is absent.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Low-score reassessment cadence | Readiness score 42/100 | Schedule follow-up: ${richScheduleHandoffPrompt} | new run directory and score comparison are produced | maintainer | Next | .qoder/better-harness run | Medium |

## Unverified Items

- CI status.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness report quality requires schedule handoff for schedule-ready Loop Discovery outcomes", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 64/100. Loop Discovery found one schedule-ready recurring validation entropy problem.

## Evidence Boundary

Static evidence, session-analysis facets, and Loop Discovery output were inspected.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Validation entropy loop | AI Agent Practices | Future harness readers | Confirmed Loop Discovery output | repeated validation drift -> no reassessment cadence -> report quality decays | Recurring drift remains prose-only and is not rechecked | Run harness again and compare loopDiscovery status |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Change Confidence | 64 | Medium | validation commands exist | recurring drift lacks a scheduled re-check |
| AI Readiness | 62 | Medium | Loop Discovery evidence was inspected | no schedule handoff is present |

## Signals And Diagnosis

Loop Discovery schedule-ready outcome: Validation entropy loop. Cadence: weekly. Validation command: node scripts/harness-analysis/validate-canvas.mjs --canvas <run>/insights.canvas.tsx. Stop condition: stop when Loop Discovery reports covered for two runs.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Validation entropy loop | Loop Discovery schedule-ready outcome | Re-run harness weekly and compare loopDiscovery status | loopDiscovery status is covered for two runs | maintainer | Next | .qoder/better-harness run | Medium |

## Unverified Items

- Host recurring schedule support.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /loop-discovery.*schedule/i.test(error)));
});

test("harness report quality rejects generic schedule handoffs for Loop Discovery outcomes", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 64/100. Loop Discovery found one schedule-ready recurring validation entropy problem.

## Evidence Boundary

Static evidence, session-analysis facets, and Loop Discovery output were inspected.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Validation entropy loop | AI Agent Practices | Future harness readers | Confirmed Loop Discovery output | repeated validation drift -> no reassessment cadence -> report quality decays | Recurring drift remains prose-only and is not rechecked | Run harness again and compare loopDiscovery status |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Change Confidence | 64 | Medium | validation commands exist | recurring drift lacks a scheduled re-check |
| AI Readiness | 62 | Medium | Loop Discovery evidence was inspected | schedule advice is generic |

## Signals And Diagnosis

Loop Discovery schedule-ready outcome: Validation entropy loop. Cadence: weekly. Validation command: node scripts/harness-analysis/validate-canvas.mjs --canvas <run>/insights.canvas.tsx. Stop condition: stop when Loop Discovery reports covered for two runs.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Validation entropy loop | Loop Discovery schedule-ready outcome | Schedule follow-up: /schedule run /better-harness weekly to improve overall engineering quality. Stop condition: stop when quality improves. | quality improves | maintainer | Next | .qoder/better-harness run | Medium |

## Unverified Items

- Host recurring schedule support.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /loop-discovery.*schedule/i.test(error)));
});

test("harness report quality accepts schedule-ready Loop Discovery outcomes with schedule handoff", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 64/100. Loop Discovery found one schedule-ready recurring validation entropy problem.

## Evidence Boundary

Static evidence, session-analysis facets, and Loop Discovery output were inspected.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Validation entropy loop | AI Agent Practices | Future harness readers | Confirmed Loop Discovery output | repeated validation drift -> no reassessment cadence -> report quality decays | Recurring drift remains prose-only and is not rechecked | Run harness again and compare loopDiscovery status |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Change Confidence | 64 | Medium | validation commands exist | recurring drift lacks a scheduled re-check |
| AI Readiness | 62 | Medium | Loop Discovery evidence was inspected | schedule handoff is ready |

## Signals And Diagnosis

Loop Discovery schedule-ready outcome: Validation entropy loop. Cadence: weekly. Validation command: node scripts/harness-analysis/validate-canvas.mjs --canvas <run>/insights.canvas.tsx. Stop condition: stop when Loop Discovery reports covered for two runs.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Validation entropy loop | Loop Discovery schedule-ready outcome | Schedule follow-up: ${richLoopScheduleHandoffPrompt} | loopDiscovery status is covered for two runs | maintainer | Next | .qoder/better-harness run | Medium |

## Unverified Items

- Host recurring schedule support.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness report quality flags bare L4 target from L2-L3 current state", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Current AI Readiness level: L2-L3.
Target AI Readiness level: L4 (Agent-Centric).

## Evidence Boundary

Build evidence: \`npm run build\` executed successfully. CI, reviewer routing,
security scanning, and API compatibility checks remain unverified.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Target level overjump | Executive verdict | Readers may expect agent-centric maturity immediately | Confirmed report gap | L2-L3 verdict -> bare L4 target -> missing L3 closure gate | Teams may skip required CI and governance work | Reframe target as near-term L3 or strategic L4 with L3 closure |

## Readiness Scorecard

| Dimension | Level | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Change Confidence | L2-L3 | Medium | build command executed | CI and review gates unverified |

## Signals And Diagnosis

The report has useful build evidence, but governance and guardrails do not yet
support an agent-centric maturity target.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L3 closure | current L2-L3 state | add CI and review gates | required gates are visible | maintainer | Now | CI config and reviewer route | High |

## Unverified Items

- Branch protection and required checks.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.equal(quality.summary.l2L3CurrentState, true);
  assert.ok(quality.errors.some((error) => /bare L4 target/i.test(error)));
});

test("harness report quality flags bare L4 target in scorecard", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Current AI Readiness level: L2-L3.

## Evidence Boundary

Build evidence exists. CI and reviewer routing remain unverified.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Target level overjump | Scorecard target | Readers may expect agent-centric maturity immediately | Confirmed report gap | L2-L3 verdict -> bare target | Teams may skip required gates | Reframe target sequence |

## Readiness Scorecard

| Dimension | Current | Target | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- | --- |
| Change Confidence | L2-L3 | L4 | Medium | build command executed | CI and review gates unverified |

## Signals And Diagnosis

The report puts the target level in the scorecard instead of the verdict.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Governance | current L2-L3 state | add CI and review gates | required gates are visible | maintainer | Now | CI config and reviewer route | High |

## Unverified Items

- Branch protection and required checks.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /bare L4 target/i.test(error)));
});

test("harness report quality accepts calibration-backed improvement target with validation gates", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 62/100. The next improvement target is a higher validation
score after CI, reviewer routing, security scanning, and API compatibility
checks are enforced and observable.

## Evidence Boundary

Build evidence: \`npm run build\` executed successfully. CI, reviewer routing,
security scanning, and API compatibility checks remain unverified.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Validation closure gate missing | Validation and governance | Agent-authored changes lack repeatable team gates | Confirmed report gap | build works -> CI and review routing unverified -> score cannot rise safely | Agent changes may rely on local success only | CI and reviewer gates are required and cited |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Change Confidence | 62 | Medium | build command executed | CI and review gates unverified |
| AI Readiness | 55 | Medium | scoped task workflow exists | agent practice evidence incomplete |

## Signals And Diagnosis

The report separates the next stable target from the longer-term ambition.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Validation closure | current score has static gaps | add CI and review gates | required gates are visible | maintainer | Now | CI config and reviewer route | High |

## Unverified Items

- Branch protection and required checks.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.equal(quality.summary.l2L3CurrentState, false);
  assert.deepEqual(quality.errors, []);
});

test("harness report quality flags strategic L4 target without L3 closure gate", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Current AI Readiness level: L3 candidate. Strategic target: L4 after broader
workflow adoption.

## Evidence Boundary

Session facets exist, but validation gates and governance mapping remain partial.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Strategic target lacks intermediate step | Target calibration | Readers may skip the next stable level | Confirmed report gap | L3 candidate -> strategic L4 -> missing intermediate step | Teams may overstate maturity | Reframe target sequence |

## Readiness Scorecard

| Dimension | Level | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Project Harness | L3 candidate | Medium | session facets exist | governance mapping remains partial |

## Signals And Diagnosis

The report names an aspirational target without the required intermediate gate.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Calibration | candidate state | reword the strategic target | report names the next stable step | maintainer | Now | report-quality output | High |

## Unverified Items

- Required checks and branch protection.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.equal(quality.summary.l2L3CurrentState, true);
  assert.ok(quality.errors.some((error) => /near-term L3 closure gate/i.test(error)));
});

test("harness report quality isolates unqualified level checks across reports", () => {
  const calibrationReport = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 62/100. Improvement target is a higher validation score
after enforcement.

## Evidence Boundary

Build evidence exists. Governance remains partial.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Improvement target boundary | Score calibration | Readers understand sequencing | Confirmed report rule check | static score -> validation gates -> higher score | Teams may overstate maturity | Keep calibration-backed target wording |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Project Harness | 62 | Medium | build evidence exists | governance remains partial |
| AI Readiness | 52 | Medium | workflow notes exist | agent use not observed |

## Signals And Diagnosis

The report separates current evidence from the next validation objective.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Calibration | score target | preserve validation gate | report-quality passes | maintainer | Now | report-quality output | High |

## Unverified Items

- Required checks and branch protection.
`;

  const levelReport = calibrationReport.replace(
    "Readiness score is 62/100. Improvement target is a higher validation score\nafter enforcement.",
    "Current AI Readiness level: L3 candidate. Strategic target: L4 after enforcement.",
  );

  assert.equal(evaluateHarnessReportQuality(calibrationReport).status, "pass");

  const quality = evaluateHarnessReportQuality(levelReport);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /unqualified Level\/Rating/i.test(error)));
});

test("harness report quality skips practice diagnosis when AI practice scope is out of scope", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 54/100; higher confidence is not proven because runtime,
compatibility, security, release, and governance paths remain unverified.

## Evidence Boundary

- AI Agent practice scope: not inspected for this report.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| High | Runtime unverified | Browser SDK runtime | All browser payment flows | Unverified high-impact | static-only -> no browser smoke -> runtime unknown | Payment flow regression can ship | Run browser smoke and cite output |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Change Confidence | 42 | Low | tests exist | nothing executed |
| AI Readiness | 38 | Low | AI practice scope was not inspected | AI delivery evidence absent |

## Signals And Diagnosis

### Change Confidence
- Observed: tests exist.
- Diagnosis: feedback path is present.
- Missing or weak: nothing was executed.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Runtime Confidence Gate | runtime unverified | run browser smoke | output is cited | owner | Now | test log | High |

## Unverified Items

- CI status.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.equal(quality.summary.aiPracticeScope, false);
  assert.deepEqual(quality.errors, []);
});

test("harness report quality flags in-scope AI Agent practices without visible practice diagnosis", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Current state is L3 candidate, but agent practice evidence is under-described.

## Evidence Boundary

- AI Agent practice scope: inspected AGENTS.md, Qoder Skills, MCP, and session facets.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Practice evidence not surfaced | Report output | Reviewers cannot see AI practice strength | Confirmed report gap | Qoder evidence -> generic synthesis -> invisible practice diagnosis | Good agent workflow evidence may be ignored | Render practice diagnosis with inspected surfaces |

## Readiness Scorecard

| Dimension | Level | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Adaptive Engineering Loop | L3 | Medium | session facets exist | practice details absent |

## Signals And Diagnosis

The report mentions generic workflow strength only.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Practice visibility | AI practice scope is in boundary | add practice diagnosis | surfaces are named | maintainer | Now | report.md | Medium |

## Unverified Items

- Runtime execution of Qoder hooks.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.equal(quality.summary.aiPracticeScope, true);
  assert.ok(quality.errors.some((error) => /AI Agent Practices section/i.test(error)));
});

test("harness report quality accepts visible AI Agent practice evidence", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 70/100 because Qoder workflow assets are visible and bounded
session evidence shows repeated validation habits.

## Evidence Boundary

- AI Agent practice scope: inspected project Rules, Skills, MCP, Plugins, and Session Insights; hook execution remains unverified.
- Session source probe: node scripts/session-analysis.mjs sources --platform qoder --workspace /Users/example/workspace/better-harness --format markdown showed enabled workspace roots.
- Session facets: node scripts/session-analysis.mjs facets --platform qoder --workspace /Users/example/workspace/better-harness --limit 20 --format json returned bounded session evidence.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Hook execution unverified | Qoder Hooks | Pre-tool guardrails may not run | Unverified runtime | static config -> no hook event sample -> enforcement unknown | Dangerous command guardrails may be assumed without proof | Capture a hook event or mark hook enforcement absent |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| AI Readiness | 70 | Medium | Qoder Skills and Session Insights show repeated workflow capture | hook runtime proof |

## Signals And Diagnosis

### AI Agent Practices

| Surface | Evidence | Diagnosis | Confidence |
| --- | --- | --- | --- |
| Rules | Project rules describe coding boundaries | positive context fluency evidence | High |
| Skills | Repeated report work is captured as a skill | positive action pathway evidence | High |
| MCP | MCP config exists but credentials were not exercised | useful integration surface with runtime gap | Medium |
| Plugins | Plugin packaging exposes skills and MCP capabilities | positive harness evidence | Medium |
| Session Insights | sampled facets show validation-after-edit habits | positive learning-capture evidence | Medium |

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hook runtime proof | hook execution remains unverified | capture one hook event | hook event cited | maintainer | Next | session log | Medium |

## Unverified Items

- Hook enforcement in live Qoder sessions.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.equal(quality.summary.aiPracticeScope, true);
  assert.deepEqual(quality.errors, []);
});

test("harness report quality accepts DESIGN.md as an AI Agent practice surface", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 64/100 because visual agent practice evidence is present but
runtime and preview checks remain unverified.

## Evidence Boundary

- AI Agent practice scope: inspected DESIGN.md visual contract and design-token evidence; no runtime enforcement claimed.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Low | Visual contract enforcement missing | Generated UI style | Agent generated screens may drift visually | Static evidence | DESIGN.md present -> no lint gate -> drift can pass review | UI generation may invent local style rules | Run designmd lint or document why the contract is advisory |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| AI Readiness | 64 | Medium | DESIGN.md contract gives reusable visual source of truth | no lint or preview evidence |

## Signals And Diagnosis

### AI Agent Practices

| Surface | Evidence | Diagnosis | Confidence |
| --- | --- | --- | --- |
| DESIGN.md | Visual design-system contract exists with design-token guidance | positive agent-readability evidence | Medium |
| Design Tokens | Tokens are available for generated UI but lint enforcement was not observed | useful contract with backstop gap | Medium |

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Design contract backstop | DESIGN.md is present | run designmd lint or add an advisory check | lint output or explicit advisory boundary cited | maintainer | Later | DESIGN.md lint output | Low |

## Unverified Items

- Visual preview and accessibility checks were not executed.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.equal(quality.summary.aiPracticeScope, true);
  assert.deepEqual(quality.errors, []);
});

test("harness report quality accepts bold AI Agent Practices label", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 62/100 with static evidence only.

## Evidence Boundary

- AI Agent practice scope: inspected project Rules, Skills, MCP, Plugins, and Session Insights; no-session boundary recorded.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Session evidence missing | AI Agent Practices | Runtime agent behavior remains unverified | Confirmed boundary | no session sources -> no observed skill use -> practice confidence capped | AI practice score may be overstated | Capture session-analysis sources or keep boundary visible |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| AI Readiness | 42 | Low | Rules and Skills were inspected | session use absent |

## Signals And Diagnosis

**AI Agent Practices:**
- Inspected: Rules, Skills, MCP, Plugins, and Session Insights.
- Boundary: no session-analysis sources were available.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Session source proof | session use absent | run session source probe | source boundary cited | maintainer | Next | session-analysis output | Medium |

## Unverified Items

- Live Qoder or Codex session behavior.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness report quality accepts native Chinese agent practice labels", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 62/100 with static evidence only.

## Evidence Boundary

- 智能体实践范围: 已检查规则、技能、MCP 和插件；运行证据未纳入。

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Practice evidence incomplete | 智能体实践 | Runtime agent behavior remains unverified | Confirmed boundary | static assets inspected -> no execution evidence -> practice confidence capped | AI practice score may be overstated | Keep the boundary visible or add execution evidence |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| AI Readiness | 42 | Low | 规则和技能已检查 | execution evidence absent |

## Signals And Diagnosis

**智能体实践:**
- 已检查：规则、技能、MCP 和插件。
- 边界：本次没有纳入运行证据。

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Practice proof | execution evidence absent | add execution evidence | boundary stays visible | maintainer | Next | report.md | Medium |

## Unverified Items

- Live Qoder or Codex session behavior.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness report quality flags coding-agent session scope without session-analysis evidence", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Current state is L3 candidate because Codex assets appear configured.

## Evidence Boundary

- AI Agent practice scope: inspected .codex sessions, Skills, MCP, Plugins, and Session Insights.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Session evidence missing | Codex practice analysis | Runtime behavior may be inferred from static files | Confirmed report gap | .codex inventory -> no workspace session probe -> runtime unknown | Reports may claim workflow habits without current-project session evidence | Run workspace-scoped session-analysis sources and facets |

## Readiness Scorecard

| Dimension | Level | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Adaptive Engineering Loop | L3 | Medium | Codex session files exist | session-analysis not cited |

## Signals And Diagnosis

### AI Agent Practices

| Surface | Evidence | Diagnosis | Confidence |
| --- | --- | --- | --- |
| Skills | Project skill files exist | candidate positive practice evidence | Medium |
| MCP | MCP config exists | candidate integration evidence | Medium |
| Session Insights | session habits are asserted | unsupported without analyzer output | Low |

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Session analysis | .codex is in scope | run sources and facets for this workspace | commands are cited | maintainer | Now | session-analysis output | Medium |

## Unverified Items

- Workspace session coverage.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /session-analysis\.mjs sources/i.test(error)));
  assert.ok(quality.errors.some((error) => /session-analysis\.mjs facets/i.test(error)));

});

test("harness report quality flags kimi-only session scope without session-analysis evidence", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Current state is L3 candidate because Kimi assets appear configured.

## Evidence Boundary

- AI Agent practice scope: inspected ~/.kimi-code/sessions, Skills, and Session Insights.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Session evidence missing | Kimi practice analysis | Runtime behavior may be inferred from static files | Confirmed report gap | .kimi-code inventory -> no workspace session probe -> runtime unknown | Reports may claim workflow habits without current-project session evidence | Run workspace-scoped session-analysis sources and facets |

## Readiness Scorecard

| Dimension | Level | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Adaptive Engineering Loop | L3 | Medium | Kimi session files exist | session-analysis not cited |

## Signals And Diagnosis

### AI Agent Practices

| Surface | Evidence | Diagnosis | Confidence |
| --- | --- | --- | --- |
| Skills | Project skill files exist | candidate positive practice evidence | Medium |
| Session Insights | session habits are asserted | unsupported without analyzer output | Low |

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Session analysis | .kimi-code is in scope | run sources and facets for this workspace | commands are cited | maintainer | Now | session-analysis output | Medium |

## Unverified Items

- Workspace session coverage.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /session-analysis\.mjs sources/i.test(error)));
  assert.ok(quality.errors.some((error) => /session-analysis\.mjs facets/i.test(error)));

  const grokQuality = evaluateHarnessReportQuality(
    report
      .replaceAll("Kimi", "Grok")
      .replaceAll("kimi", "grok")
      .replaceAll(".grok-code", ".grok"),
  );
  assert.equal(grokQuality.status, "fail");
  assert.ok(grokQuality.errors.some((error) => /session-analysis\.mjs sources/i.test(error)));
  assert.ok(grokQuality.errors.some((error) => /session-analysis\.mjs facets/i.test(error)));
});

test("harness report quality requires practice surfaces inside the practice diagnosis", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Current state is L3 candidate, but practice details remain too generic.

## Evidence Boundary

- AI Agent practice scope: inspected Rules, Skills, MCP, Plugins, and Session Insights.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Practice evidence too generic | Report output | Reviewers cannot map evidence to inspected assets | Confirmed report gap | scoped inventory -> generic practice summary -> no per-surface diagnosis | Strong workflow evidence may be treated as unsupported | Name inspected surfaces in the practice block |

## Readiness Scorecard

| Dimension | Level | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Adaptive Engineering Loop | L3 | Medium | repeated validation habits | practice block lacks concrete inspected assets |

## Signals And Diagnosis

### AI Agent Practices

The inspected project setup shows useful operating habits and review boundaries,
but this paragraph does not identify which concrete asset categories were
reviewed.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Practice diagnosis | practice scope is in boundary | add concrete inspected assets | visible practice block names the inspected asset categories | maintainer | Now | report.md | Medium |

## Unverified Items

- Runtime execution remains unverified.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /must name inspected surfaces/i.test(error)));
});

test("harness report quality flags ownership-worded review routing titles", () => {
  const report = `# Better Harness 就绪度报告

## 执行结论

当前分数为 54/100；治理路径未验证。

## 证据边界

仅静态证据包。

## 风险发现

| 严重性 | 发现 | 受影响子系统 | 影响范围 | 证据强度 | 根因链 | 未修复风险 | 通过检查 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 中 | 核心代码所有权缺失 | runner/ 核心路径 | 核心路径变更可能缺少指定评审人 | 已确认 | no review route -> no required reviewer -> core path review is ad hoc | 核心路径变更可能漏审 | CODEOWNERS 或等效保护规则覆盖 runner/ |

## 就绪度记分卡

| 维度 | 分数 | 置信度 | 最强证据 | 主要缺口 |
| --- | --- | --- | --- | --- |
| Change Safety | 44 | High | no owner rule | review route missing |
| AI 就绪度 | 40 | Medium | review route can support agent changes | AI practice evidence absent |
| AI 就绪度 | 40 | Medium | review route can support agent changes | AI practice evidence absent |

## 信号与诊断

仓库治理证据不足。

## 行动路径

| 路径 | 触发证据 | 下一步行动 | 通过检查 | 负责人 | 时机 | 证据产物 | 影响 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Core path review route | runner/ lacks required reviewer | add scoped reviewer route | protected review route exists | maintainer | 下一步 | CODEOWNERS | 中 |

## 未验证事项

- branch protection.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /ownership-worded review-routing title/i.test(error)));
});

test("harness report quality flags no-CODEOWNERS wording for core path coverage gaps", () => {
  const report = `# Better Harness 就绪度报告

## 执行结论

当前为 L2；核心路径评审路由未验证。

## 证据边界

仅静态证据包。

## 风险发现

| 严重性 | 发现 | 受影响子系统 | 影响范围 | 证据强度 | 根因链 | 未修复风险 | 通过检查 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 中 | 核心路径评审人未指定 | runner/ 核心路径 | 核心路径变更可能缺少指定评审人 | 已确认 | 无 CODEOWNERS -> 无自动评审路由 -> 依赖人工协调 | 核心路径变更可能漏审 | CODEOWNERS 明确覆盖 runner/ 核心路径 |

## 就绪度记分卡

| 维度 | 等级 | 置信度 | 最强证据 | 主要缺口 |
| --- | --- | --- | --- | --- |
| Change Safety | L2 | High | CODEOWNERS present | core path review route missing |

## 信号与诊断

仓库治理证据不足。

## 行动路径

| 路径 | 触发证据 | 下一步行动 | 通过检查 | 负责人 | 时机 | 证据产物 | 影响 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Core path review route | runner/ not listed in CODEOWNERS | add scoped reviewer route | CODEOWNERS covers runner/ core paths | maintainer | 下一步 | CODEOWNERS | 中 |

## 未验证事项

- branch protection.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /CODEOWNERS coverage wording/i.test(error)));
  assert.ok(quality.errors.some((error) => /CODEOWNERS absence wording requires GitHub host evidence/i.test(error)));
});

test("harness report quality accepts scoped CODEOWNERS root cause with core files", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Readiness score is 58/100 with static governance evidence.

## Evidence Boundary

Static evidence only. No required owner-review route was found for the listed core files.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Core path acceptance control not configured | Governance / Code Review | All core library files lack a required reviewer route | Confirmed static gap | listed core files have no required owner-review route | Core API changes may merge without domain review | Protected owner/reviewer route covers listed core files |

Core files:
- \`index.js\`
- \`lib/main.js\`

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| AI Readiness | 35 | Low | agent practice evidence absent | no observed session use |

## Signals And Diagnosis

Engineering Implementation: required owner-review routing is absent for listed core files.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Core acceptance control | listed core files lack a required owner-review route | add scoped protected owner/reviewer route | protected owner/reviewer route covers listed core files | maintainer | Next | owner/reviewer route | Medium |

## Unverified Items

- Branch protection.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness report quality requires core files for core path reviewer gaps", () => {
  const report = `# Better Harness 就绪度报告

## 执行结论

当前为 L2；核心路径评审路由未验证。

## 证据边界

仅静态证据包。

## 风险发现

| 严重性 | 发现 | 受影响子系统 | 影响范围 | 证据强度 | 根因链 | 未修复风险 | 通过检查 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 中 | 核心路径评审人未指定 | runner/ 核心路径 | 核心路径变更可能缺少指定评审人 | 已确认 | CODEOWNERS 未覆盖核心路径 -> 无自动评审路由 -> 依赖人工协调 | 核心路径变更可能漏审 | CODEOWNERS 明确覆盖相关核心文件 |

## 就绪度记分卡

| 维度 | 等级 | 置信度 | 最强证据 | 主要缺口 |
| --- | --- | --- | --- | --- |
| Change Safety | L2 | High | CODEOWNERS present | core path review route missing |

## 信号与诊断

仓库治理证据不足。

## 行动路径

| 路径 | 触发证据 | 下一步行动 | 通过检查 | 负责人 | 时机 | 证据产物 | 影响 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Core path review route | core files not listed in CODEOWNERS | add scoped reviewer route | CODEOWNERS covers affected core files | maintainer | 下一步 | CODEOWNERS | 中 |

## 未验证事项

- branch protection.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /core files.*list/i.test(error)));
});

test("harness report quality accepts scoped reviewer-routing titles", () => {
  const report = `# Better Harness 就绪度报告

## 执行结论

当前分数为 54/100；治理路径未验证。

## 证据边界

仅静态证据包。

## 风险发现

| 严重性 | 发现 | 核心文件 | 受影响子系统 | 影响范围 | 证据强度 | 根因链 | 未修复风险 | 通过检查 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 中 | 核心路径评审人未指定 | scripts/core-change-watch/**, hooks/git-scripts/blast-radius/** | runner/ 核心路径 | 核心路径变更可能缺少指定评审人 | 已确认 | CODEOWNERS 未覆盖核心文件 -> 无自动评审路由 -> 依赖人工协调 | 核心路径变更可能漏审 | CODEOWNERS 或等效保护规则覆盖列出的核心文件 |

## 就绪度记分卡

| 维度 | 分数 | 置信度 | 最强证据 | 主要缺口 |
| --- | --- | --- | --- | --- |
| Change Safety | 44 | High | no owner rule | review route missing |
| AI 就绪度 | 40 | Medium | review route can support agent changes | AI practice evidence absent |

## 信号与诊断

仓库治理证据不足。

## 行动路径

| 路径 | 触发证据 | 下一步行动 | 通过检查 | 负责人 | 时机 | 证据产物 | 影响 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Core path review route | listed core files lack required reviewer | add scoped reviewer route | protected review route covers listed core files | maintainer | 下一步 | CODEOWNERS | 中 |

## 未验证事项

- branch protection.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness report quality accepts calibration-backed capability rows without diagnostic model notes", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Current state is mixed.

## Evidence Boundary

Static scan only.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Runtime unverified | Harness | Generated reports | Static evidence | report -> no runtime check | User may trust unverified results | Run smoke check |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Context Map | 84 | High | AGENTS.md | none |
| Environment Readiness | 68 | Medium | package scripts | env reset missing |
| Fast Feedback | 66 | Medium | tests | affected checks missing |
| Quality Gates | 42 | Low | lint rules | constraints missing |
| Change Safety | 64 | Medium | CODEOWNERS | branch protection unverified |
| AI Readiness | 58 | Medium | agent workflow notes exist | observed skill use missing |
| AI Readiness | 58 | Medium | agent workflow notes exist | observed skill use missing |

## Signals And Diagnosis

Observed project-capability spread across current evidence.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Explain model | scorecard labels | add notes | diagnostic model notes visible | owner | Now | report.md | Medium |

## Unverified Items

- Runtime.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness report quality flags legacy 5R dimension guide headings", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Current state is mixed.

## Evidence Boundary

Static scan only.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Runtime unverified | Harness | Generated reports | Static evidence | report -> no runtime check | User may trust unverified results | Run smoke check |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Context Map | 84 | High | AGENTS.md | none |
| Environment Readiness | 68 | Medium | package scripts | env reset missing |
| Fast Feedback | 66 | Medium | tests | affected checks missing |
| Quality Gates | 42 | Low | lint rules | constraints missing |
| Change Safety | 64 | Medium | CODEOWNERS | branch protection unverified |
| AI Readiness | 58 | Medium | agent workflow notes exist | observed skill use missing |

## Signals And Diagnosis

Observed project-capability spread across current evidence.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Explain model | scorecard labels | add guide | guide visible | owner | Now | report.md | Medium |

## Unverified Items

- Runtime.

## 5R Dimension Guide

| Dimension | Meaning |
| --- | --- |
| Context Map | Can an agent understand project boundaries and task routes quickly? |
| Environment Readiness | Can an agent set up, run, reset, and operate the workspace? |
| Fast Feedback | Can an agent get fast, actionable feedback after a change? |
| Quality Gates | Are important rules mechanically enforced? |
| Change Safety | Can agent-produced changes be constrained at runtime, checked before acceptance, and prevented from unsafe side effects or uncontrolled delivery? |
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /5R Dimension Guide/i.test(error)));
});

test("harness report quality accepts capability reports with final diagnostic model notes", () => {
  const report = `# Better Harness Readiness Report

## Executive Verdict

Current state is mixed.

## Evidence Boundary

Static scan only.

## Risk Findings

| Severity | Finding | Affected subsystem | Blast radius | Evidence strength | Root-cause chain | Risk if unfixed | Pass check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Medium | Runtime unverified | Harness | Generated reports | Static evidence | report -> no runtime check | User may trust unverified results | Run smoke check |

## Readiness Scorecard

| Dimension | Score | Confidence | Strongest evidence | Main gap |
| --- | --- | --- | --- | --- |
| Context Map | 84 | High | AGENTS.md | none |
| Environment Readiness | 68 | Medium | package scripts | env reset missing |
| Fast Feedback | 66 | Medium | tests | affected checks missing |
| Quality Gates | 42 | Low | lint rules | constraints missing |
| Change Safety | 64 | Medium | CODEOWNERS | branch protection unverified |
| AI Readiness | 58 | Medium | agent workflow notes exist | observed skill use missing |

## Signals And Diagnosis

Observed project-capability spread across current evidence.

## Action Pathways

| Pathway | Trigger evidence | Next action | Pass check | Owner | Timing | Evidence artifact | Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Explain model | scorecard labels | add notes | notes visible at the end | owner | Now | report.md | Medium |

## Unverified Items

- Runtime.

## Diagnostic Model Notes

| Dimension | Meaning |
| --- | --- |
| Context Map | Can an agent understand project boundaries and task routes quickly? |
| Environment Readiness | Can an agent set up, run, reset, and operate the workspace? |
| Fast Feedback | Can an agent get fast, actionable feedback after a change? |
| Quality Gates | Are important rules mechanically enforced? |
| Change Safety | Can agent-produced changes be constrained at runtime, checked before acceptance, and prevented from unsafe side effects or uncontrolled delivery? |

Adaptive Engineering Loop synthesizes evidence across the five project capabilities as an improvement loop.
`;

  const quality = evaluateHarnessReportQuality(report);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness canvas quality flags light risk data", () => {
  const canvas = `
const STAGES = [{ id: "change-confidence", name: "Change Confidence", score: 2, status: "low" }];
const CELLS = [{ scopeId: "main-gap", dimensionId: "change-confidence", level: "No test step" }];
const ACTION_ROWS = [{ pathway: "Add CI", timing: "Now", impact: "High", action: "Run tests" }];
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /severity/i.test(error)));
  assert.ok(quality.errors.some((error) => /evidence/i.test(error)));
  assert.ok(quality.errors.some((error) => /recommendation/i.test(error)));
  assert.ok(quality.errors.some((error) => /passCheck/i.test(error)));
});

test("harness canvas quality accepts style framing without visible AI Readiness score row", () => {
  const canvas = `
import { SendToChatButton } from "qoder/canvas";

const RISK_FINDINGS = [{
  severity: "High",
  blastRadius: "All browser payment flows",
  riskIfUnfixed: "Broken commits can ship",
  rootCauseChain: "tests fail -> CI omits test gate -> release proceeds",
  affectedSubsystem: "Change confidence",
  evidenceStrength: "High local run evidence",
  passCheck: "CI fails on test failure",
  timing: "Now",
  impact: "High",
}];
export default function Report() {
  return <SendToChatButton text="${richAiFixPrompt}" options={{ submit: false }}>Draft fix plan</SendToChatButton>;
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness canvas quality flags ownership-worded review routing card titles", () => {
  const canvas = `
const RISK_FINDINGS = [{
  title: "核心代码所有权缺失",
  severity: "Medium",
  blastRadius: "runner/ core paths",
  riskIfUnfixed: "Core path changes may miss required review",
  rootCauseChain: "no review route -> no required reviewer -> core path review is ad hoc",
  affectedSubsystem: "Change Safety",
  evidenceStrength: "Confirmed",
  passCheck: "CODEOWNERS or equivalent review routing covers runner/",
  timing: "Next",
  impact: "Medium",
}];
export default function Report() {
  return null;
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /ownership-worded review-routing title/i.test(error)));
});

test("harness canvas quality flags no-CODEOWNERS wording for core path coverage gaps", () => {
  const canvas = `
import { SendToChatButton } from "qoder/canvas";

const RISK_FINDINGS = [{
  title: "核心路径评审人未指定",
  severity: "Medium",
  blastRadius: "runner/ core paths",
  riskIfUnfixed: "Core path changes may miss required review",
  rootCauseChain: "无 CODEOWNERS -> 无自动评审路由 -> 依赖人工协调",
  affectedSubsystem: "Change Safety",
  evidenceStrength: "Confirmed",
  passCheck: "CODEOWNERS covers runner/ core paths",
  timing: "Next",
  impact: "Medium",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 40, confidence: "Medium" }];
export default function Report() {
  return "AI Readiness score 40 <SendToChatButton />";
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /CODEOWNERS coverage wording/i.test(error)));
});

test("harness canvas quality requires coreFiles for core path reviewer gaps", () => {
  const canvas = `
import { SendToChatButton } from "qoder/canvas";

const RISK_FINDINGS = [{
  title: "核心路径评审人未指定",
  severity: "Medium",
  blastRadius: "runner/ core paths",
  riskIfUnfixed: "Core path changes may miss required review",
  rootCauseChain: "CODEOWNERS does not cover core files -> no automatic review route -> manual coordination",
  affectedSubsystem: "Change Safety",
  evidenceStrength: "Confirmed",
  passCheck: "CODEOWNERS covers affected core files",
  timing: "Next",
  impact: "Medium",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 40, confidence: "Medium" }];
export default function Report() {
  return "AI Readiness score 40 <SendToChatButton />";
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /core files.*list/i.test(error)));
});

test("harness canvas quality accepts scoped reviewer-routing card titles", () => {
  const canvas = `
import { SendToChatButton } from "qoder/canvas";

const RISK_FINDINGS = [{
  title: "核心路径评审人未指定",
  coreFiles: ["scripts/core-change-watch/**", "hooks/git-scripts/blast-radius/**"],
  severity: "Medium",
  blastRadius: "runner/ core paths",
  riskIfUnfixed: "Core path changes may miss required review",
  rootCauseChain: "CODEOWNERS does not cover listed core files -> no required reviewer -> core path review is ad hoc",
  affectedSubsystem: "Change Safety",
  evidenceStrength: "Confirmed",
  passCheck: "CODEOWNERS or equivalent review routing covers listed core files",
  timing: "Next",
  impact: "Medium",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 40, confidence: "Medium" }];
export default function Report() {
  return "AI Readiness score 40 <SendToChatButton />";
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness canvas quality accepts root-level Go core file lists", () => {
  const canvas = `
import { SendToChatButton } from "qoder/canvas";

const RISK_FINDINGS = [{
  title: "CODEOWNERS does not list core library files",
  coreFiles: ["webinfo.go", "fetch.go", "errs.go"],
  severity: "Medium",
  blastRadius: "Core Go library files",
  riskIfUnfixed: "Core path changes may miss required review",
  rootCauseChain: "CODEOWNERS does not list webinfo.go, fetch.go, or errs.go -> no required reviewer -> core path review is ad hoc",
  affectedSubsystem: "Governance / reviewer routing",
  evidenceStrength: "Confirmed",
  passCheck: "CODEOWNERS or equivalent review routing covers listed Go core files",
  timing: "Next",
  impact: "Medium",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 40, confidence: "Medium" }];
export default function Report() {
  return "AI Readiness score 40 <SendToChatButton />";
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness canvas quality requires four visible H2 reader parts", () => {
  const canvas = `
import { SendToChatButton } from "qoder/canvas";

const FINDINGS = [{
  id: "ENG-001",
  title: "Runtime unverified",
  domain: "engineering-implementation",
  severity: "High",
  confidence: "High",
  affectedSubsystem: "Runtime",
  blastRadius: "All users",
  evidenceStrength: "Confirmed",
  rootCauseChain: "no smoke -> unknown runtime",
  riskIfUnfixed: "Broken commits can ship",
  recommendation: "Run smoke",
  passCheck: "Smoke passes",
  timing: "Now",
  impact: "High",
  coreFiles: ["src/main.ts"],
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 40, confidence: "Medium" }];
export default function Report() {
  return (
    <>
      <H2>Findings and Actions</H2>
      <H2>Additional Suggestions</H2>
      <H2>Score Notes</H2>
      <SendToChatButton text="fix" options={{ submit: false }}>Fix</SendToChatButton>
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /exactly four visible H2 reader parts/i.test(error)));
  assert.ok(quality.errors.some((error) => /H2 1 must be a style-selected framing label/i.test(error)));
});

test("harness canvas quality treats table-only visual density as nonblocking", () => {
  const canvas = `
import { H2, MetricsGrid, SendToChatButton, Table } from "qoder/canvas";

const FINDINGS = [{
  title: "Runtime unverified",
  severity: "High",
  confidence: "High",
  blastRadius: "All users",
  riskIfUnfixed: "Broken canvas can ship",
  rootCauseChain: "no preview smoke -> runtime unknown",
  affectedSubsystem: "Canvas runtime",
  evidenceStrength: "Confirmed local gap",
  passCheck: "Preview health and module load",
  timing: "Now",
  impact: "High",
  aiFixPrompt: "${richAiFixPrompt}",
}];
const SCORECARD_ROWS = [
  { dimension: "Context Map", score: 72, confidence: "High" },
  { dimension: "AI Readiness", score: 58, confidence: "Medium" },
];
export default function Report() {
  return (
    <>
      <H2>Score Dimensions</H2>
      <MetricsGrid items={SCORECARD_ROWS} />
      <Table columns={[{ key: "dimension", header: "Dimension" }, { key: "score", header: "Score" }]} rows={SCORECARD_ROWS} />
      <MetricsGrid items={[{ label: "High", value: 1 }, { label: "Medium", value: 2 }]} />
      <Table columns={[{ key: "title", header: "Finding" }, { key: "severity", header: "Severity" }]} rows={FINDINGS} />
      <H2>Findings And AI Actions</H2>
      <SendToChatButton text={FINDINGS[0].aiFixPrompt} options={{ submit: false }}>Draft fix plan</SendToChatButton>
      <H2>Suggestions</H2>
      <Table columns={[{ key: "title", header: "Finding" }, { key: "timing", header: "Timing" }]} rows={FINDINGS} />
      <H2>Dimension And Method Notes</H2>
      <Table columns={[{ key: "dimension", header: "Dimension" }, { key: "confidence", header: "Confidence" }]} rows={SCORECARD_ROWS} />
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.summary.chartVisualComponents, []);
  assert.deepEqual(quality.errors, []);
});

test("harness canvas quality rejects SDK-empty chart and table data props", () => {
  const canvas = `
import { BarChart, H2, SendToChatButton, Table } from "qoder/canvas";

const SCORECARD_ROWS = [
  { dimension: "Context Map", score: 72, confidence: "High" },
  { dimension: "AI Readiness", score: 68, confidence: "Medium" },
];
const FINDINGS = [{
  title: "Runtime unverified",
  severity: "High",
  confidence: "High",
  blastRadius: "All users",
  riskIfUnfixed: "Broken canvas can ship",
  rootCauseChain: "no preview smoke -> runtime unknown",
  affectedSubsystem: "Canvas runtime",
  evidenceStrength: "Confirmed local gap",
  passCheck: "Preview health and module load",
  timing: "Now",
  impact: "High",
  aiFixLabel: "Draft fix plan",
  aiFixPrompt: "${richAiFixPrompt}",
}];
export default function Report() {
  return (
    <>
      <H2>Score Dimensions</H2>
      <BarChart data={SCORECARD_ROWS} />
      <Table columns={[{ key: "dimension", header: "Dimension" }]} data={SCORECARD_ROWS} />
      <BarChart data={[{ label: "High", value: 1 }]} />
      <H2>Findings And AI Actions</H2>
      <SendToChatButton text={FINDINGS[0].aiFixPrompt} options={{ submit: false }}>{FINDINGS[0].aiFixLabel}</SendToChatButton>
      <H2>Suggestions</H2>
      <H2>Dimension And Method Notes</H2>
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /BarChart uses unsupported data prop/i.test(error)));
  assert.ok(quality.errors.some((error) => /BarChart must provide categories and series props/i.test(error)));
  assert.ok(quality.errors.some((error) => /Table uses unsupported data prop/i.test(error)));
  assert.ok(quality.errors.some((error) => /Table must provide rows prop/i.test(error)));
});

test("harness canvas quality rejects ignored SDK component props", () => {
  const canvas = `
import { H2, MetricItem, SendToChatButton, Stack, Stat, Tag } from "qoder/canvas";

const FINDINGS = [{
  title: "Runtime unverified",
  severity: "High",
  confidence: "High",
  blastRadius: "All users",
  riskIfUnfixed: "Broken canvas can ship",
  rootCauseChain: "no preview smoke -> runtime unknown",
  affectedSubsystem: "Canvas runtime",
  evidenceStrength: "Confirmed local gap",
  passCheck: "Preview health and module load",
  timing: "Now",
  impact: "High",
  aiFixLabel: "Draft fix plan",
  aiFixPrompt: "${richAiFixPrompt}",
}];
export default function Report() {
  return (
    <>
      <H2>Score Dimensions</H2>
      <MetricItem label="AI Readiness" value={72} />
      <Stack direction="row" gap={8}>
        <Tag color="red">High</Tag>
        <Stat value={72} suffix="/100" />
      </Stack>
      <H2>Findings And AI Actions</H2>
      <SendToChatButton text={FINDINGS[0].aiFixPrompt} options={{ submit: false }}>{FINDINGS[0].aiFixLabel}</SendToChatButton>
      <H2>Suggestions</H2>
      <H2>Dimension And Method Notes</H2>
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /MetricItem is a MetricsGrid item type/i.test(error)));
  assert.ok(quality.errors.some((error) => /Stack does not support a direction prop/i.test(error)));
  assert.ok(quality.errors.some((error) => /Tag uses unsupported color prop/i.test(error)));
  assert.ok(quality.errors.some((error) => /Stat uses unsupported suffix prop/i.test(error)));
  assert.ok(quality.errors.some((error) => /Stat must provide a label prop/i.test(error)));
});

test("harness canvas quality flags static risk and action rows without AI handoffs", () => {
  const canvas = `
const RISK_FINDINGS = [{
  finding: "Runtime unverified",
  severity: "High",
  blastRadius: "All Qoder Canvas readers",
  riskIfUnfixed: "Broken canvas can ship",
  rootCauseChain: "no preview smoke -> runtime unknown",
  affectedSubsystem: "Canvas runtime",
  evidenceStrength: "Confirmed local gap",
  passCheck: "Preview health and module load",
  timing: "Now",
  impact: "High",
}];
const ACTION_PATHWAYS = [{ pathway: "Runtime Confidence Gate", timing: "Now", impact: "High" }];
export default function Report() {
  return null;
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /row-scoped AI handoffs/i.test(error)));
});

test("harness canvas quality rejects label-only AI fix prompts", () => {
  const canvas = `
import { SendToChatButton } from "qoder/canvas";

const RISK_FINDINGS = [{
  title: "Runtime unverified",
  severity: "High",
  blastRadius: "All users",
  riskIfUnfixed: "Broken canvas can ship",
  rootCauseChain: "no preview smoke -> runtime unknown",
  affectedSubsystem: "Canvas runtime",
  evidenceStrength: "Confirmed local gap",
  passCheck: "Preview health and module load",
  timing: "Now",
  impact: "High",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 58, confidence: "Medium" }];
export default function Report() {
  return <SendToChatButton text="起草修复方案" options={{ submit: false }}>起草修复方案</SendToChatButton>;
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /label-only prompt/i.test(error)));
});

test("harness canvas quality rejects key-value AI fix prompt packets", () => {
  const canvas = `
import { SendToChatButton } from "qoder/canvas";

const FINDINGS = [{
  title: "Runtime unverified",
  severity: "High",
  blastRadius: "All users",
  riskIfUnfixed: "Broken canvas can ship",
  rootCauseChain: "no preview smoke -> runtime unknown",
  affectedSubsystem: "Canvas runtime",
  evidenceStrength: "Confirmed local gap",
  passCheck: "Preview health and module load",
  timing: "Now",
  impact: "High",
  aiFixPrompt: "/better-harness repair-plan target=/tmp/fixture-project finding=R1 evidence=report-quality request=add validation acceptance=passes validation=run node risk=generated safety=no-source-edits",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 38, confidence: "Low" }];
export default function Report() {
  return FINDINGS.map((row) => (
    <SendToChatButton text={row.aiFixPrompt} options={{ submit: false }}>Draft fix plan</SendToChatButton>
  ));
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /full AI handoff prompts/i.test(error)));
});

test("harness canvas quality rejects row.prompt AI fix bindings without repair-plan source", () => {
  const canvas = `
import { SendToChatButton } from "qoder/canvas";

const FINDINGS = [{
  title: "Runtime unverified",
  severity: "High",
  blastRadius: "All users",
  riskIfUnfixed: "Broken canvas can ship",
  rootCauseChain: "no preview smoke -> runtime unknown",
  affectedSubsystem: "Canvas runtime",
  evidenceStrength: "Confirmed local gap",
  passCheck: "Preview health and module load",
  timing: "Now",
  impact: "High",
  prompt: "Draft fix plan",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 38, confidence: "Low" }];
export default function Report() {
  return FINDINGS.map((row) => (
    <SendToChatButton text={row.prompt} options={{ submit: false }}>Draft fix plan</SendToChatButton>
  ));
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /row\.aiFixPrompt.*not row\.prompt/i.test(error)));
});

test("harness canvas quality accepts row aiFixPrompt repair-plan handoffs", () => {
  const canvas = `
import { SendToChatButton } from "qoder/canvas";

const FINDINGS = [{
  title: "Runtime unverified",
  severity: "High",
  blastRadius: "All users",
  riskIfUnfixed: "Broken canvas can ship",
  rootCauseChain: "no preview smoke -> runtime unknown",
  affectedSubsystem: "Canvas runtime",
  evidenceStrength: "Confirmed local gap",
  passCheck: "Preview health and module load",
  timing: "Now",
  impact: "High",
  aiFixPrompt: "${richAiFixPrompt}",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 38, confidence: "Low" }];
export default function Report() {
  return FINDINGS.map((row) => (
    <SendToChatButton text={row.aiFixPrompt} options={{ submit: false }}>Draft fix plan</SendToChatButton>
  ));
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness canvas quality accepts row aiFixPrompt non-repair handoffs", () => {
  const canvas = `
import { SendToChatButton } from "qoder/canvas";

const FINDINGS = [{
  title: "Runtime unverified",
  severity: "High",
  blastRadius: "All users",
  riskIfUnfixed: "Broken canvas can ship",
  rootCauseChain: "no preview smoke -> runtime unknown",
  affectedSubsystem: "Canvas runtime",
  evidenceStrength: "Confirmed local gap",
  passCheck: "Preview health and module load",
  timing: "Now",
  impact: "High",
  aiFixLabel: "Extend Skill",
  aiFixPrompt: "${richSkillHandoffPrompt}",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 58, confidence: "Medium" }];
export default function Report() {
  return FINDINGS.map((row) => (
    <SendToChatButton text={row.aiFixPrompt} options={{ submit: false }}>{row.aiFixLabel}</SendToChatButton>
  ));
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness canvas quality requires schedule handoff for complete low-score canvas", () => {
  const canvas = `
import { H2, SendToChatButton } from "qoder/canvas";

const FINDINGS = [{
  title: "Runtime unverified",
  severity: "High",
  blastRadius: "All users",
  riskIfUnfixed: "Broken canvas can ship",
  rootCauseChain: "no preview smoke -> runtime unknown",
  affectedSubsystem: "Canvas runtime",
  evidenceStrength: "Confirmed local gap",
  passCheck: "Preview health and module load",
  timing: "Now",
  impact: "High",
  aiFixPrompt: "${richAiFixPrompt}",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 38, confidence: "Low" }];
export default function Report() {
  return (
    <>
      <H2>Score Dimensions</H2>
      <H2>Findings And AI Actions</H2>
      <H2>Suggestions</H2>
      <H2>Dimension And Method Notes</H2>
      <SendToChatButton text={FINDINGS[0].aiFixPrompt} options={{ submit: false }}>Draft fix plan</SendToChatButton>
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /low-score.*schedule/i.test(error)));
});

test("harness canvas quality accepts complete low-score canvas with schedule handoff", () => {
  const canvas = `
import { BarChart, H2, RiskHeatmap, SendToChatButton } from "qoder/canvas";

const FINDINGS = [{
  title: "Low score follow-up",
  severity: "Medium",
  blastRadius: "Future harness readers",
  riskIfUnfixed: "Low readiness may remain invisible after the first report",
  rootCauseChain: "low score -> no reassessment cadence -> improvement drift",
  affectedSubsystem: "AI Agent Practices",
  evidenceStrength: "Confirmed score evidence",
  passCheck: "Scheduled runs compare the score against the previous run",
  timing: "Next",
  impact: "Medium",
  aiFixLabel: "Schedule follow-up",
  aiFixPrompt: "${richScheduleHandoffPrompt}",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 38, confidence: "Low" }];
const RISK_HOTSPOTS = [{ label: "Medium", value: 1, severity: "Medium" }];
export default function Report() {
  return (
    <>
      <H2>Score Dimensions</H2>
      <BarChart
        categories={SCORECARD_ROWS.map((row) => row.dimension)}
        series={[{ name: "Score", data: SCORECARD_ROWS.map((row) => row.score) }]}
      />
      <RiskHeatmap data={RISK_HOTSPOTS} />
      <H2>Findings And AI Actions</H2>
      <H2>Suggestions</H2>
      <H2>Dimension And Method Notes</H2>
      <SendToChatButton text={FINDINGS[0].aiFixPrompt} options={{ submit: false }}>{FINDINGS[0].aiFixLabel}</SendToChatButton>
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness canvas quality requires schedule handoff for schedule-ready Loop Discovery outcomes", () => {
  const canvas = `
import { BarChart, H2, RiskHeatmap, SendToChatButton, Text } from "qoder/canvas";

const REPORT = {
  summary: {
    aiAgentPractice: {
      loopDiscovery: {
        decision: "schedule-ready",
        finding: "Validation entropy loop",
        cadence: "weekly",
        validationCommand: "node scripts/harness-analysis/validate-canvas.mjs --canvas <run>/insights.canvas.tsx",
        stopCondition: "stop when Loop Discovery reports covered for two runs",
      },
    },
  },
};
const FINDINGS = [{
  id: "AIA-LOOP-001",
  title: "Validation entropy loop",
  severity: "Medium",
  blastRadius: "Future harness readers",
  riskIfUnfixed: "Recurring drift remains prose-only and is not rechecked",
  rootCauseChain: "repeated validation drift -> no reassessment cadence -> report quality decays",
  affectedSubsystem: "AI Agent Practices",
  evidenceStrength: "Confirmed Loop Discovery output",
  passCheck: "Loop Discovery reports covered for two runs",
  timing: "Next",
  impact: "Medium",
  aiFixLabel: "Draft fix plan",
  aiFixPrompt: "${richAiFixPrompt}",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 62, confidence: "Medium" }];
const RISK_HOTSPOTS = [{ label: "Medium", value: 1, severity: "Medium" }];
export default function Report() {
  return (
    <>
      <H2>Score Dimensions</H2>
      <BarChart
        categories={SCORECARD_ROWS.map((row) => row.dimension)}
        series={[{ name: "Score", data: SCORECARD_ROWS.map((row) => row.score) }]}
      />
      <RiskHeatmap data={RISK_HOTSPOTS} />
      <H2>Findings And AI Actions</H2>
      <Text>{REPORT.summary.aiAgentPractice.loopDiscovery.decision}</Text>
      <SendToChatButton text={FINDINGS[0].aiFixPrompt} options={{ submit: false }}>{FINDINGS[0].aiFixLabel}</SendToChatButton>
      <H2>Suggestions</H2>
      <H2>Dimension And Method Notes</H2>
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /loop-discovery.*schedule/i.test(error)));
});

test("harness canvas quality rejects generic schedule handoffs for Loop Discovery outcomes", () => {
  const canvas = `
import { BarChart, H2, RiskHeatmap, SendToChatButton, Text } from "qoder/canvas";

const REPORT = {
  summary: {
    aiAgentPractice: {
      loopDiscovery: {
        decision: "schedule-ready",
        finding: "Validation entropy loop",
        cadence: "weekly",
        validationCommand: "node scripts/harness-analysis/validate-canvas.mjs --canvas <run>/insights.canvas.tsx",
        stopCondition: "stop when Loop Discovery reports covered for two runs",
      },
    },
  },
};
const FINDINGS = [{
  id: "AIA-LOOP-001",
  title: "Validation entropy loop",
  severity: "Medium",
  blastRadius: "Future harness readers",
  riskIfUnfixed: "Recurring drift remains prose-only and is not rechecked",
  rootCauseChain: "repeated validation drift -> no reassessment cadence -> report quality decays",
  affectedSubsystem: "AI Agent Practices",
  evidenceStrength: "Confirmed Loop Discovery output",
  passCheck: "Loop Discovery reports covered for two runs",
  timing: "Next",
  impact: "Medium",
  aiFixLabel: "Schedule follow-up",
  aiFixPrompt: "/schedule run /better-harness weekly to improve overall engineering quality. Stop condition: stop when quality improves.",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 62, confidence: "Medium" }];
const RISK_HOTSPOTS = [{ label: "Medium", value: 1, severity: "Medium" }];
export default function Report() {
  return (
    <>
      <H2>Score Dimensions</H2>
      <BarChart
        categories={SCORECARD_ROWS.map((row) => row.dimension)}
        series={[{ name: "Score", data: SCORECARD_ROWS.map((row) => row.score) }]}
      />
      <RiskHeatmap data={RISK_HOTSPOTS} />
      <H2>Findings And AI Actions</H2>
      <Text>{REPORT.summary.aiAgentPractice.loopDiscovery.decision}</Text>
      <SendToChatButton text={FINDINGS[0].aiFixPrompt} options={{ submit: false }}>{FINDINGS[0].aiFixLabel}</SendToChatButton>
      <H2>Suggestions</H2>
      <H2>Dimension And Method Notes</H2>
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /loop-discovery.*schedule/i.test(error)));
});

test("harness canvas quality accepts schedule-ready Loop Discovery outcomes with schedule handoff", () => {
  const canvas = `
import { BarChart, H2, RiskHeatmap, SendToChatButton, Text } from "qoder/canvas";

const REPORT = {
  summary: {
    aiAgentPractice: {
      loopDiscovery: {
        decision: "schedule-ready",
        finding: "Validation entropy loop",
        cadence: "weekly",
        validationCommand: "node scripts/harness-analysis/validate-canvas.mjs --canvas <run>/insights.canvas.tsx",
        stopCondition: "stop when Loop Discovery reports covered for two runs",
      },
    },
  },
};
const FINDINGS = [{
  id: "AIA-LOOP-001",
  title: "Validation entropy loop",
  severity: "Medium",
  blastRadius: "Future harness readers",
  riskIfUnfixed: "Recurring drift remains prose-only and is not rechecked",
  rootCauseChain: "repeated validation drift -> no reassessment cadence -> report quality decays",
  affectedSubsystem: "AI Agent Practices",
  evidenceStrength: "Confirmed Loop Discovery output",
  passCheck: "Loop Discovery reports covered for two runs",
  timing: "Next",
  impact: "Medium",
  aiFixLabel: "Schedule follow-up",
  aiFixPrompt: "${richLoopScheduleHandoffPrompt}",
}];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 62, confidence: "Medium" }];
const RISK_HOTSPOTS = [{ label: "Medium", value: 1, severity: "Medium" }];
export default function Report() {
  return (
    <>
      <H2>Score Dimensions</H2>
      <BarChart
        categories={SCORECARD_ROWS.map((row) => row.dimension)}
        series={[{ name: "Score", data: SCORECARD_ROWS.map((row) => row.score) }]}
      />
      <RiskHeatmap data={RISK_HOTSPOTS} />
      <H2>Findings And AI Actions</H2>
      <Text>{REPORT.summary.aiAgentPractice.loopDiscovery.decision}</Text>
      <SendToChatButton text={FINDINGS[0].aiFixPrompt} options={{ submit: false }}>{FINDINGS[0].aiFixLabel}</SendToChatButton>
      <H2>Suggestions</H2>
      <H2>Dimension And Method Notes</H2>
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness canvas quality rejects standalone action pathway arrays", () => {
  const canvas = `
import { SendToChatButton } from "qoder/canvas";

const RISK_FINDINGS = [{
  finding: "Runtime unverified",
  severity: "High",
  blastRadius: "All Qoder Canvas readers",
  riskIfUnfixed: "Broken canvas can ship",
  rootCauseChain: "no preview smoke -> runtime unknown",
  affectedSubsystem: "Canvas runtime",
  evidenceStrength: "Confirmed local gap",
  recommendation: "Run preview health and module checks before shipping",
  passCheck: "Preview health and module load",
  timing: "Now",
  impact: "High",
}];
const ACTION_PATHWAYS = [{ pathway: "Runtime Confidence Gate", timing: "Now", impact: "High" }];
const SCORECARD_ROWS = [{ dimension: "AI Readiness", score: 38, confidence: "Low" }];
export default function Report() {
  return (
    <SendToChatButton text="${richAiFixPrompt}" options={{ submit: false }}>
      Draft fix plan
    </SendToChatButton>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /ACTION_PATHWAYS.*shared finding rows/i.test(error)));
});

test("harness canvas quality accepts visible missing-export action fallback", () => {
  const canvas = `
const RISK_FINDINGS = [{
  finding: "Runtime unverified",
  severity: "High",
  blastRadius: "All Qoder Canvas readers",
  riskIfUnfixed: "Broken canvas can ship",
  rootCauseChain: "no preview smoke -> runtime unknown",
  affectedSubsystem: "Canvas runtime",
  evidenceStrength: "Confirmed local gap",
  passCheck: "Preview health and module load",
  timing: "Now",
  impact: "High",
}];
export default function Report() {
  return "AI Readiness score 42. SendToChatButton missing-export fallback: draft fix plan";
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness canvas quality flags deprecated standalone note labels", () => {
  const canvas = `
import { DocsSection, H2, MetricsGrid, SendToChatButton, Stack, Text } from "qoder/canvas";

const metrics = [{ label: "静态证据索引", value: 42, suffix: "/100", tone: "warning" }];
const RISK_FINDINGS = [{
  finding: "Runtime unverified",
  severity: "High",
  blastRadius: "All Qoder Canvas readers",
  riskIfUnfixed: "Broken canvas can ship",
  rootCauseChain: "static scan -> no preview smoke -> runtime unknown",
  affectedSubsystem: "Canvas runtime",
  evidenceStrength: "Confirmed local gap",
  passCheck: "Preview health and module load",
  timing: "Now",
  impact: "High",
}];
const ACTION_PATHWAYS = [{ pathway: "Runtime Confidence Gate", timing: "Now", impact: "High" }];
export default function Report() {
  return (
    <Stack>
      <MetricsGrid items={metrics} />
      <Text>证据边界：静态文件检查 + 会话分析（已执行）</Text>
      <H2>维度说明与证据边界</H2>
      <DocsSection title="静态证据边界" />
      <DocsSection title="未验证项（高影响路径未检查）" />
      <SendToChatButton text="${richAiFixPrompt}" options={{ submit: false }}>Draft fix plan</SendToChatButton>
    </Stack>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /deprecated standalone note labels/i.test(error)));
  assert.ok(quality.errors.some((error) => /证据边界/.test(error)));
  assert.ok(quality.errors.some((error) => /未验证项/.test(error)));
  assert.ok(quality.errors.some((error) => /deprecated static-only score labels/i.test(error)));
  assert.ok(quality.errors.some((error) => /deprecated metadata labels/i.test(error)));
});

test("harness canvas quality flags layout anti-patterns", () => {
  const canvas = `
import { Stack, Row, H2, Divider, Spacer, ImprovementKataCard } from "qoder/canvas";

const RISK_FINDINGS = [{
  severity: "High",
  blastRadius: "All CI gates",
  riskIfUnfixed: "Broken commits can ship",
  rootCauseChain: "tests fail -> CI omits test gate -> release proceeds",
  affectedSubsystem: "Change confidence",
  evidenceStrength: "High local run evidence",
  passCheck: "CI fails on test failure",
  timing: "Now",
  impact: "High",
}];

export default function Report() {
  return (
    <Stack gap="lg">
      <Row gap="sm" />
      <Divider />
      <H2>Priority Prescriptions</H2>
      <ImprovementKataCard current="CI soft failure" target="strict gate" />
      <Spacer size="md" />
      <ImprovementKataCard current="No fast path" target="mapped checks" variant="card" />
      <Divider />
    </Stack>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /string gap/i.test(error)));
  assert.ok(quality.errors.some((error) => /Spacer.*size/i.test(error)));
  assert.ok(quality.errors.some((error) => /bare Divider/i.test(error)));
  assert.ok(quality.errors.some((error) => /Priority Prescriptions.*Grid/i.test(error)));
  assert.ok(quality.errors.some((error) => /variant="card"/i.test(error)));
});

test("harness canvas quality accepts explicit Fluency scale visuals", () => {
  const canvas = `
const RISK_FINDINGS = [{
  severity: "Medium",
  blastRadius: "Generated reports",
  riskIfUnfixed: "Readers may not understand capability scores",
  rootCauseChain: "visual labels -> no definitions -> reader confusion",
  affectedSubsystem: "Report companion",
  evidenceStrength: "Template review",
  passCheck: "Diagnostic Model Notes are visible near the end",
  timing: "Now",
  impact: "Medium",
  aiFixPrompt: "${richAiFixPrompt}",
}];
const stages = [
  { id: "context-map", name: "Context Map", score: 4, status: "high" },
  { id: "environment", name: "Environment Readiness", score: 3, status: "medium" },
  { id: "fast-feedback", name: "Fast Feedback", score: 3, status: "medium" },
  { id: "quality-gates", name: "Quality Gates", score: 2, status: "low" },
  { id: "safe-change", name: "Change Safety", score: 3, status: "medium" },
];
export default function Report() {
  return (
    <>
      <Fluency
        stages={stages}
        min={1}
        max={5}
        mediumThreshold={3}
        highThreshold={4}
      />
      <SendToChatButton text={RISK_FINDINGS[0].aiFixPrompt} options={{ submit: false }}>Draft fix plan</SendToChatButton>
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness canvas quality accepts visible diagnostic model notes", () => {
  const canvas = `
const RISK_FINDINGS = [{
  severity: "Medium",
  blastRadius: "Generated reports",
  riskIfUnfixed: "Readers may not understand capability scores",
  rootCauseChain: "visual labels -> no definitions -> reader confusion",
  affectedSubsystem: "Report companion",
  evidenceStrength: "Template review",
  passCheck: "Diagnostic Model Notes are visible near the end",
  timing: "Next",
  impact: "Medium",
}];
const DIAGNOSTIC_MODEL_NOTES = [
  { dimension: "Context Map", meaning: "Understand project boundaries and task routes." },
  { dimension: "Environment Readiness", meaning: "Set up, run, reset, and operate the workspace." },
  { dimension: "Fast Feedback", meaning: "Get fast, actionable feedback after changes." },
  { dimension: "Quality Gates", meaning: "Mechanically enforce important rules." },
  { dimension: "Change Safety", meaning: "Constrain agent changes, check acceptance, and bound unsafe side effects." },
];
export default function Report() {
  return "AI Readiness score 58. Diagnostic Model Notes near end. Adaptive Engineering Loop synthesizes evidence across project capabilities. SendToChatButton missing-export fallback.";
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness canvas quality flags one-to-five Fluency without explicit scale", () => {
  const canvas = `
const RISK_FINDINGS = [{
  severity: "High",
  blastRadius: "All browser payment flows",
  riskIfUnfixed: "Broken commits can ship",
  rootCauseChain: "tests fail -> CI omits test gate -> release proceeds",
  affectedSubsystem: "Change confidence",
  evidenceStrength: "High local run evidence",
  passCheck: "CI fails on test failure",
  timing: "Now",
  impact: "High",
}];
const stages = [{ id: "context-map", name: "Context Map", score: 3, status: "medium" }];
export default function Report() {
  return <Fluency stages={stages} />;
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /Fluency.*1-5.*min.*max.*threshold/i.test(error)));
});

test("harness canvas quality flags runtime-prone report primitive prop shapes", () => {
  const canvas = `
const RISK_FINDINGS = [{
  severity: "High",
  blastRadius: "All browser payment flows",
  riskIfUnfixed: "Broken commits can ship",
  rootCauseChain: "tests fail -> CI omits test gate -> release proceeds",
  affectedSubsystem: "Change confidence",
  evidenceStrength: "High local run evidence",
  passCheck: "CI fails on test failure",
  timing: "Now",
  impact: "High",
}];
const matrixDimensions = [{ id: "project-harness", title: "Project Harness" }];
const matrixScopes = [{ id: "f2", title: "F2 Structured" }];
const matrixCells: Record<string, Record<string, { tone: "high" }>> = {
  "project-harness": { f2: { tone: "high" } },
};
export default function Report() {
  return (
    <>
      <MaturityMatrix dimensions={matrixDimensions} scopes={matrixScopes} cells={matrixCells} />
      <ImprovementKataCard
        title="Fix CI"
        description="Add strict gates"
        evidence="Static file inspection"
        actions={[{ label: "Act", prompt: "Fix CI" }]}
      />
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /MaturityMatrix cells.*array/i.test(error)));
  assert.equal(quality.errors.some((error) => /ImprovementKataCard.*description prop/i.test(error)), false);
  assert.equal(quality.errors.some((error) => /actions.*ReactNode/i.test(error)), false);
  assert.equal(quality.errors.some((error) => /evidence.*ReactNode\[\] array/i.test(error)), false);
});

test("harness canvas quality rejects swapped priority quadrant axes", () => {
  const canvas = `
import { MetricsGrid, PriorityQuadrantChart, SendToChatButton } from "qoder/canvas";

const RISK_FINDINGS = [{
  severity: "High",
  blastRadius: "All browser payment flows",
  riskIfUnfixed: "Broken commits can ship",
  rootCauseChain: "tests fail -> CI omits test gate -> release proceeds",
  affectedSubsystem: "Change confidence",
  evidenceStrength: "High local run evidence",
  passCheck: "CI fails on test failure",
  timing: "Now",
  impact: "High",
}];
const metrics = [{ label: "AI Readiness", value: 58 }];
const priorities = [
  { label: "Runtime Confidence Gate", impact: 88, complexity: 32 },
  { label: "Reviewer Routing", impact: 70, complexity: 44 },
];
export default function Report() {
  return (
    <>
      <MetricsGrid items={metrics} />
      <PriorityQuadrantChart data={priorities} xAxis="影响力" yAxis="实施复杂度" />
      <SendToChatButton text="${richAiFixPrompt}" options={{ submit: false }}>Draft fix plan</SendToChatButton>
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /PriorityQuadrantChart.*x-axis.*effort\/complexity.*y-axis.*impact/i.test(error)));
});

test("harness canvas quality rejects coarse priority quadrant coordinates", () => {
  const canvas = `
import { MetricsGrid, PriorityQuadrantChart, SendToChatButton } from "qoder/canvas";

const RISK_FINDINGS = [{
  severity: "High",
  blastRadius: "All browser payment flows",
  riskIfUnfixed: "Broken commits can ship",
  rootCauseChain: "tests fail -> CI omits test gate -> release proceeds",
  affectedSubsystem: "Change confidence",
  evidenceStrength: "High local run evidence",
  passCheck: "CI fails on test failure",
  timing: "Now",
  impact: "High",
}];
const metrics = [{ label: "AI Readiness", value: 58 }];
const priorities = [
  { label: "Runtime Confidence Gate", impact: 85, complexity: 30 },
  { label: "Reviewer Routing", impact: 85, complexity: 30 },
  { label: "Supply Chain Scan", impact: 85, complexity: 30 },
];
export default function Report() {
  return (
    <>
      <MetricsGrid items={metrics} />
      <PriorityQuadrantChart data={priorities} xLabel="实施复杂度" yLabel="影响力" />
      <SendToChatButton text="${richAiFixPrompt}" options={{ submit: false }}>Draft fix plan</SendToChatButton>
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "fail");
  assert.ok(quality.errors.some((error) => /PriorityQuadrantChart.*duplicate or coarse coordinates/i.test(error)));
});

test("harness canvas quality accepts risk-rich score data", () => {
  const canvas = `
import { MetricsGrid, SendToChatButton } from "qoder/canvas";

const RISK_FINDINGS = [{
  severity: "High",
  blastRadius: "All browser payment flows",
  riskIfUnfixed: "Broken commits can ship",
  rootCauseChain: "tests fail -> CI omits test gate -> release proceeds",
  affectedSubsystem: "Change confidence",
  evidenceStrength: "High local run evidence",
  passCheck: "CI fails on test failure",
  timing: "Now",
  impact: "High",
}];
const metrics = [
  { label: "Change confidence", value: 66, suffix: "/100", tone: "warning" },
  { label: "AI Readiness", value: 58, suffix: "/100", tone: "warning" },
];
export default function Report() {
  return (
    <>
      <MetricsGrid items={metrics} />
      <SendToChatButton text="${richAiFixPrompt}" options={{ submit: false }}>Draft fix plan</SendToChatButton>
    </>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});

test("harness canvas quality accepts controlled section layout", () => {
  const canvas = `
import { Stack, Grid, H2, Divider, ImprovementKataCard, SendToChatButton } from "qoder/canvas";

const RISK_FINDINGS = [{
  severity: "High",
  blastRadius: "All browser payment flows",
  riskIfUnfixed: "Broken commits can ship",
  rootCauseChain: "tests fail -> CI omits test gate -> release proceeds",
  affectedSubsystem: "Change confidence",
  evidenceStrength: "High local run evidence",
  passCheck: "CI fails on test failure",
  timing: "Now",
  impact: "High",
}];

export default function Report() {
  return (
    <Stack gap={20}>
      <Divider style={{ margin: "4px 0 12px" }} />
      <Stack gap={8}>
        <H2>AI Readiness</H2>
        <H2>Priority Prescriptions</H2>
        <Grid columns="repeat(auto-fit, minmax(min(100%, 520px), 1fr))" gap={16}>
          <ImprovementKataCard current="CI soft failure" target="strict gate" variant="auto" />
          <ImprovementKataCard
            current="No fast path"
            target="mapped checks"
            variant="auto"
            actions={(<SendToChatButton text="${richAiFixPrompt}" options={{ submit: false }}>Draft fix plan</SendToChatButton>)}
          />
        </Grid>
      </Stack>
    </Stack>
  );
}
`;

  const quality = evaluateHarnessCanvasQuality(canvas);

  assert.equal(quality.status, "pass");
  assert.deepEqual(quality.errors, []);
});
