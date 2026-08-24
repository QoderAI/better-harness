import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";

import {
  AGENT_WORK_LOOP_DIMENSIONS,
  AGENT_WORK_LOOP_MODEL_ID,
  AGENT_WORK_LOOP_REPORT_CONTRACT_VERSION,
  FINDING_TARGET_REPORT_CONTRACT_VERSION,
  agentWorkLoopDimensionScoreCeiling,
  scoreAgentWorkLoopDimension,
  scoreAgentWorkLoopEvidence,
} from "../../scripts/harness-analysis/fluency-dimensions.mjs";

function read(relativePath) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function reviewMapRows(markdown) {
  const lines = markdown.split("\n");
  const start = lines.indexOf("## Review map");
  assert.notEqual(start, -1);
  const endOffset = lines.slice(start + 1).findIndex((line) => line.startsWith("## "));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  return lines.slice(start + 1, end)
    .filter((line) => line.startsWith("| **"))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
}

test("Agent Work Loop runtime exposes one immutable five-by-three contract", () => {
  assert.equal(AGENT_WORK_LOOP_MODEL_ID, "agent-work-loop-v4");
  assert.equal(FINDING_TARGET_REPORT_CONTRACT_VERSION, 26);
  assert.equal(AGENT_WORK_LOOP_REPORT_CONTRACT_VERSION, 26);
  assert.equal(Object.isFrozen(AGENT_WORK_LOOP_DIMENSIONS), true);
  assert.deepEqual(AGENT_WORK_LOOP_DIMENSIONS.map((dimension) => dimension.id), [
    "task-understanding",
    "controlled-execution",
    "change-validation",
    "reliable-delivery",
    "learning-capture",
  ]);
  assert.equal(AGENT_WORK_LOOP_DIMENSIONS.every((dimension) => dimension.subdimensions.length === 3), true);
  assert.equal(new Set(AGENT_WORK_LOOP_DIMENSIONS.flatMap((dimension) => (
    dimension.subdimensions.map((check) => check.id)
  ))).size, 15);
  assert.equal(AGENT_WORK_LOOP_DIMENSIONS.every((dimension) => (
    dimension.label && dimension.zhLabel && dimension.question && dimension.zhQuestion
  )), true);
});

test("Agent Work Loop review map mirrors the runtime dimension contract", () => {
  const markdown = read("models/agent-work-loop.md");
  const rows = reviewMapRows(markdown);
  assert.deepEqual(
    rows.map((row) => row[0].replaceAll("**", "")),
    AGENT_WORK_LOOP_DIMENSIONS.map((dimension) => dimension.label),
  );
  assert.deepEqual(
    rows.map((row) => row[1].replaceAll("`", "")),
    AGENT_WORK_LOOP_DIMENSIONS.map((dimension) => dimension.id),
  );

  const headings = new Set(markdown.split("\n").filter((line) => line.startsWith("## ")));
  for (const [index, dimension] of AGENT_WORK_LOOP_DIMENSIONS.entries()) {
    assert.equal(headings.has(`## ${index + 1}. ${dimension.label}`), true);
  }
});

test("Learning Capture cannot inherit deterministic current-task scores", () => {
  const learningCapture = AGENT_WORK_LOOP_DIMENSIONS.find((dimension) => dimension.id === "learning-capture");
  assert.equal(learningCapture.crossWindow, true);
  assert.equal(scoreAgentWorkLoopEvidence({ id: "lifecycle-repeat-detection", state: "Exercised" }), null);
  assert.equal(scoreAgentWorkLoopDimension(learningCapture.subdimensions), null);
  assert.equal(agentWorkLoopDimensionScoreCeiling([learningCapture, ...learningCapture.subdimensions]), null);

  assert.equal(scoreAgentWorkLoopEvidence({ id: "relevant-check", state: "Exercised" }), 75);
  assert.equal(scoreAgentWorkLoopDimension([
    { id: "goal-understanding", state: "Present" },
    { id: "relevant-context", state: "Wired" },
    { id: "scope-boundary", state: "Exercised" },
  ]), 58);
});

test("legacy maturity owners stay removed", () => {
  for (const relativePath of [
    "models/index.md",
    "models/better-harness-agent-fluency.md",
    "models/harness-engineering-fluency.md",
    "skills/better-harness/references/learning-capture-review.md",
  ]) assert.equal(existsSync(path.join(process.cwd(), relativePath)), false, relativePath);
});
