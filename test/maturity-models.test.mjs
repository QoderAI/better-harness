import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AGENT_WORK_LOOP_DIMENSIONS,
  AGENT_WORK_LOOP_MODEL_ID,
  AGENT_WORK_LOOP_REPORT_CONTRACT_VERSION,
  FINDING_TARGET_REPORT_CONTRACT_VERSION,
  agentWorkLoopDimensionScoreCeiling,
  scoreAgentWorkLoopDimension,
  scoreAgentWorkLoopEvidence,
} from "../scripts/harness-analysis/fluency-dimensions.mjs";

function read(root, relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function markdownSection(content, heading) {
  const marker = `## ${heading}`;
  const start = content.indexOf(marker);
  assert.notEqual(start, -1, `${heading} section must exist`);
  const next = content.indexOf("\n## ", start + marker.length);
  return content.slice(start, next === -1 ? content.length : next);
}

test("Agent Work Loop runtime metadata stays separate from the review model", () => {
  const root = process.cwd();
  const routing = read(root, "models/routing.md");
  const software = read(root, "models/software-fluency.md");
  const workLoop = read(root, "models/agent-work-loop.md");
  const evidenceBridge = workLoop;
  const harness = read(root, "models/harness-engineering.md");
  const factory = read(root, "case-studies/factory/model/factory-readiness.md");
  const concepts = read(root, "docs/concepts.md");
  const glossary = read(root, "docs/glossary.md");
  const canvasOutput = read(root, "templates/reporting/qoder-canvas.md");
  const observability = read(root, "references/project-harness/observability.md");
  const coreChange = read(root, "references/project-harness/core-change-watch.md");
  const projectOverlays = read(root, "references/project-harness/project-overlays.md");
  const rationale = read(root, "models/agent-work-loop-rationale.md");

  assert.equal(existsSync(path.join(root, "models", "index.md")), false);
  assert.equal(existsSync(path.join(root, "models", "better-harness-agent-fluency.md")), false);
  assert.equal(existsSync(path.join(root, "references", "detector")), false);
  assert.match(routing, /Default Harness readiness/);
  assert.match(routing, /agent-work-loop\.md/);
  assert.match(routing, /Static project scan/);
  assert.match(routing, /software-fluency\.md/);
  assert.match(routing, /harness-engineering\.md/);
  assert.doesNotMatch(routing, /harness-engineering-fluency\.md/);
  assert.match(routing, /five independently scored dimensions without a headline average/);
  assert.match(routing, /case-studies\/factory\/model\/factory-readiness\.md/);
  assert.match(glossary, /\[model routing\]\(\.\.\/models\/routing\.md\)/);
  assert.doesNotMatch(glossary, /references\/detector/);
  assert.match(coreChange, /Bounded History Claim Guardrails/);
  assert.match(coreChange, /historyProfile\.confidence/);

  assert.match(software, /# Software Fluency/);
  for (const heading of [
    "### Dimension 1: Context Map",
    "### Dimension 2: Environment Readiness",
    "### Dimension 3: Fast Feedback",
    "### Dimension 4: Quality Gates",
    "### Dimension 5: Change Safety",
  ]) assert.match(software, new RegExp(heading));

  assert.equal(AGENT_WORK_LOOP_MODEL_ID, "agent-work-loop-v4");
  assert.equal(FINDING_TARGET_REPORT_CONTRACT_VERSION, 26);
  assert.equal(AGENT_WORK_LOOP_REPORT_CONTRACT_VERSION, 26);
  assert.match(workLoop, /^# Agent Work Loop\n/);
  assert.match(workLoop, /## Review map/);
  assert.match(workLoop, /## Evidence, findings, and scores/);
  assert.doesNotMatch(workLoop, /agent-work-loop-v\d+|report contract v\d+/);
  assert.match(workLoop, /Runtime schemas and compatibility versions belong to their validators and\s+constants, not this review model/);
  assert.match(workLoop, /never derive a dimension score from finding counts/);
  assert.match(workLoop, /current-task\s+exercise without a later comparison at 74/);
  assert.match(workLoop, /pending Asset Health \/ Repair Progress finding/);
  assert.match(workLoop, /### Finding-bound repair progress/);
  assert.match(workLoop, /one independent\s+reviewer to judge that finding as `verified`, `partial`, or `blocked`/);
  assert.match(workLoop, /updates Asset Health \/ Repair Progress only/);
  assert.match(workLoop, /dimension scores \*\*Loop Effectiveness\*\*/);
  assert.match(workLoop, /If independent repair review is unavailable, record the verified\s+output while leaving Repair Progress pending/);
  assert.equal(
    [...workLoop.matchAll(/\| Check \| Description \|/g)].length,
    5,
  );
  assert.equal([...workLoop.matchAll(/^### Look for$/gm)].length, 5);
  assert.equal([...workLoop.matchAll(/^### Typical findings$/gm)].length, 5);
  assert.equal([...workLoop.matchAll(/^- \*\*Assets:\*\*/gm)].length, 15);
  assert.equal([...workLoop.matchAll(/^- \*\*How to decide:\*\*/gm)].length, 15);
  assert.equal([...workLoop.matchAll(/^- \*\*Example finding:\*\*/gm)].length, 15);
  assert.equal([...workLoop.matchAll(/^- \*\*Emit only when:\*\*/gm)].length, 15);
  assert.doesNotMatch(workLoop, /\| Check \| Assets and evidence \| How to decide \|/);
  assert.doesNotMatch(workLoop, /\| Check \| Example finding \| Evidence required before emitting it \|/);
  assert.doesNotMatch(workLoop, /\| Check \| Inspect \| Pass \/ strong evidence \| Partial, fail, or finding condition \|/);
  assert.doesNotMatch(workLoop, /## Operational crosswalk|## Project overlays|## Primary-source alignment|## Finding and projection boundary/);
  assert.match(workLoop, /For confirmed visual work, inspect an applicable root `DESIGN\.md`/);
  assert.match(workLoop, /core-change-watch evidence-pack --cwd <target> --json/);
  assert.match(workLoop, /Logger imports, call\s+counts, dashboards, and “few logs” are only search leads/);
  assert.match(workLoop, /#### Core and high-impact observability judgment/);
  assert.match(workLoop, /\*\*Ready:\*\*[\s\S]*\*\*Partial:\*\*[\s\S]*\*\*Blocked:\*\*[\s\S]*\*\*Not applicable:\*\*/);
  for (const owner of [observability, coreChange]) {
    assert.match(owner, /agent-work-loop\.md#core-and-high-impact-observability-judgment/);
    assert.doesNotMatch(owner, /#core-change-observability-gate/);
  }
  for (const projectShape of [
    "Library or SDK",
    "Frontend or visual application",
    "Backend or multi-service system",
    "Generator, DSL, or schema owner",
    "Infrastructure, migration, release, or external automation",
    "Documentation, template, or plugin package",
  ]) assert.match(projectOverlays, new RegExp(projectShape));
  assert.match(projectOverlays, /never adds a\s+dimension or check/);
  for (const heading of [
    "## Task Understanding",
    "## Controlled Execution",
    "## Change Validation",
    "## Reliable Delivery",
    "## Learning Capture",
  ]) assert.match(rationale, new RegExp(heading));
  assert.match(rationale, /not an evidence source for scoring a project/);

  assert.equal(AGENT_WORK_LOOP_DIMENSIONS.length, 5);
  assert.equal(AGENT_WORK_LOOP_DIMENSIONS.flatMap((dimension) => dimension.subdimensions).length, 15);
  const learningLoop = AGENT_WORK_LOOP_DIMENSIONS.find((dimension) => dimension.id === "learning-capture");
  assert.match(learningLoop.question, /maintenance opportunities/);
  assert.match(learningLoop.zhQuestion, /维护机会/);
  assert.equal(scoreAgentWorkLoopEvidence({ id: "lifecycle-repeat-detection", state: "Exercised" }), null);
  assert.equal(scoreAgentWorkLoopDimension(learningLoop.subdimensions), null);
  assert.equal(agentWorkLoopDimensionScoreCeiling([learningLoop, ...learningLoop.subdimensions]), null);
  for (const [index, dimension] of AGENT_WORK_LOOP_DIMENSIONS.entries()) {
    assert.match(workLoop, new RegExp(`## ${index + 1}\\. ${dimension.label}`));
    assert.match(workLoop, new RegExp("\\| \\*\\*" + dimension.label + "\\*\\* \\| `" + dimension.id + "`"));
    assert.match(workLoop, new RegExp(dimension.question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const check of dimension.subdimensions) {
      assert.ok(workLoop.includes(`\`${check.id}\``));
      assert.ok(workLoop.includes(`**${check.label}**`));
    }
  }
  assert.match(evidenceBridge, /## Construct Task Episode Evidence/);
  assert.match(evidenceBridge, /this model remains the owner of checks, evidence states,\s+findings, and scoring/);
  assert.doesNotMatch(workLoop, /task-alignment|bounded-execution|trusted-delivery|experience-codification|adaptive-improvement/);

  assert.match(harness, /^# Harness Engineering\n/);
  assert.match(harness, /Use it under `software-fluency`/);
  assert.equal(existsSync(path.join(root, "models", "harness-engineering-fluency.md")), false);
  assert.match(factory, /model_id: factory-readiness/);
  for (const owner of [concepts, glossary, canvasOutput]) {
    assert.match(owner, /Agent Work Loop/);
    assert.match(owner, /Software Fluency|software-fluency/);
    assert.match(owner, /static|project/i);
    assert.doesNotMatch(owner, /no usable sessions[\s\S]{0,120}fallback|otherwise use the\s+Software Fluency scaffold as a fallback/i);
  }
});

test("Agent Work Loop owns Learning Capture opportunity routing mechanics", () => {
  const root = process.cwd();
  const workLoop = read(root, "models/agent-work-loop.md");
  const route = workLoop;
  const skillDiscovery = read(root, "references/agent-customize/skill-discovery.md");

  assert.doesNotMatch(workLoop, /### Lifecycle Skill and repeated-work detection/);
  assert.match(workLoop, /Follow the \[Review Procedure\]\(#review-procedure\)/);
  assert.match(workLoop, /Generated lifecycle and learning diagnostics remain read-only review inputs/);
  assert.match(route, /`repositoryEvidence\.workflowDemandDiagnostics`/);
  for (const command of ["/ultraplan", "/plan", "/spec", "/story", "/issue-*", "/review"]) {
    assert.ok(route.includes(`\`${command}\``), `${command} must remain a lifecycle entry point`);
  }

  assert.match(route, /#### Resolve the Opportunity Class/);
  for (const reviewClass of ["Current capability gap", "Repeated opportunity", "Entropy-backed opportunity", "Adequate no-candidate window"]) {
    assert.match(route, new RegExp(reviewClass));
  }
  assert.match(route, /current handoff may support an owner-aligned current-dimension finding/);
  assert.match(route, /Repeated or entropy-backed\s+evidence can advance to Loop Engineering/);
  assert.match(workLoop, /missing same-name Skill/);
  assert.match(route, /File age, churn, unresolved markers,\s+asset counts.*remain leads, not clean or repairable outcomes/s);
  assert.match(route, /For any fallback finding required by the model/);
  assert.match(route, /bind at least one real `repeatedCandidates` lead/);
  assert.match(workLoop, /does not default to a Skill/);
  assert.match(workLoop, /explicit adequate clean no-candidate result is the\s+only no-match outcome that may remain finding-free/);

  const normalizedRoute = route.replace(/\s+/gu, " ");
  const normalizedSkillDiscovery = skillDiscovery.replace(/\s+/gu, " ");
  for (const evidenceClass of [
    "confirmed project activation",
    "unscoped observed activation",
  ]) {
    assert.ok(normalizedSkillDiscovery.includes(evidenceClass), `${evidenceClass} must stay with Skill Discovery`);
    assert.ok(!normalizedRoute.includes(evidenceClass), `${evidenceClass} must not be copied into Learning Capture review`);
  }
  assert.ok(normalizedSkillDiscovery.includes("apparent reads"), "Skill Discovery must classify apparent reads");

  assert.match(skillDiscovery, /observed -> platform built-in -> configured -> extend -> create ->\s+needs evidence ladder/);
  assert.match(route, /as read-only review leads under\s+`repositoryEvidence\.learningCaptureDiagnostics`/);
  assert.match(route, /When Loop Discovery\s+selects a Skill-shaped procedure, use\s+\[Skill Discovery\]/);
  assert.doesNotMatch(route, /Author an integer Learning Capture score/);
  assert.equal(existsSync(path.join(root, "skills/better-harness/references/learning-capture-review.md")), false);
});

test("Learning Capture keeps current evidence separate from longitudinal validation", () => {
  const root = process.cwd();
  const workLoop = read(root, "models/agent-work-loop.md");
  const learningCapture = markdownSection(workLoop, "5. Learning Capture");
  const learningReview = workLoop;
  const scheduled = read(root, "references/loop-engineering/patterns/scheduled-inspection.md");

  assert.match(learningCapture, /one Agent-authored score, not three subscores/);
  assert.match(learningCapture, /Resolve\s+Lifecycle Opportunity Detection and Loop Engineering from the bounded current\s+review/);
  assert.match(learningCapture, /Longitudinal Validation gates\s+effect claims/);
  assert.match(learningCapture, /later-outcome evaluation/);
  assert.match(learningCapture, /recurring maintenance\/freshness inspection/);
  assert.match(learningCapture, /clean no-change inspection is valid `Exercised` evidence/);
  assert.match(learningCapture, /File age or\s+missed cadence starts inspection but cannot prove drift/);
  assert.match(learningCapture, /lifecycle, recurring, and\s+maintenance opportunities/);
  assert.match(learningCapture, /#### Maintenance and freshness routing/);
  assert.match(learningCapture, /File age, last commit or release age, missed cadence, an old-looking version,\s+a newer upstream release, and missing update automation are inspection\s+triggers only/);
  assert.match(learningCapture, /a dependency that is not the latest release is not necessarily\s+obsolete/);
  assert.match(learningCapture, /unsupported or end-of-life under the project's applicable\s+support policy/);
  assert.match(learningCapture, /Without that\s+comparison, keep the result as a lead or `Unobserved`, not a finding/);
  assert.match(learningReview, /Scheduled Inspection/);
  assert.doesNotMatch(learningReview, /## Longitudinal evidence modes/);
  assert.doesNotMatch(learningReview, /Only a comparable later outcome may support `Outcome-supported`/);
  assert.match(scheduled, /canonical truth or\s+invariant used for comparison/);
  assert.match(scheduled, /File age, churn, unresolved markers,\s+and item counts may select the inspection window but cannot decide/);
  assert.match(workLoop, /explicit adequate clean no-candidate result is the\s+only no-match outcome that may remain finding-free/);
  assert.match(workLoop, /Agent-authored integer from 35 through 100/);
  assert.match(workLoop, /does not\s+award points for Findings, states, asset\s+counts, or configured mechanisms/);
  assert.match(learningCapture, /no accepted supported match is a\s+decision, not an empty result/);
  assert.match(learningCapture, /missing-mechanism finding/);
  assert.match(learningCapture, /evidence-gap finding/);
});
