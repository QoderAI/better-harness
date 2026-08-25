import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";

import { RENDER_REPORT_PLATFORMS } from "../../scripts/harness-analysis/render-report.mjs";
import { HOST_CAPABILITIES, hostIdsFor } from "../../scripts/host-support/index.mjs";

const ROOT = process.cwd();
const SKILL_PATH = "skills/better-harness/SKILL.md";

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function frontmatter(markdown) {
  const lines = markdown.split("\n");
  assert.equal(lines[0], "---", "Skill must start with YAML front matter");
  const closing = lines.indexOf("---", 1);
  assert.notEqual(closing, -1, "Skill front matter must close");
  return Object.fromEntries(lines.slice(1, closing).map((line) => {
    const separator = line.indexOf(":");
    assert.ok(separator > 0, `invalid front matter line: ${line}`);
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
}

function textFenceLines(markdown) {
  const lines = [];
  let inTextFence = false;
  for (const line of markdown.split("\n")) {
    if (line === "```text") {
      inTextFence = true;
      continue;
    }
    if (line === "```" && inTextFence) {
      inTextFence = false;
      continue;
    }
    if (inTextFence && line.trim()) lines.push(line.trim());
  }
  return lines;
}

test("Better Harness Skill keeps a compact ordered workflow contract", () => {
  const skill = read(SKILL_PATH);
  const metadata = frontmatter(skill);

  assert.deepEqual(Object.keys(metadata).sort(), ["description", "name"]);
  assert.equal(metadata.name, "better-harness");
  assert.equal(metadata.description.startsWith("Use when "), true);
  assert.equal(metadata.description.includes("/better-harness"), true);
  assert.equal(metadata.description.endsWith("Invoke only via slash command."), true);
  assert.ok(skill.split("\n").length < 220, "root Skill must remain compact");
  assert.ok(Buffer.byteLength(skill) < 12_000, "root Skill must stay below the prompt budget");

  const levelTwoHeadings = skill.split("\n").filter((line) => line.startsWith("## "));
  assert.deepEqual(levelTwoHeadings, [
    "## Step 1: Resolve Scope and Collect the Evidence Bundle",
    "## Step 2: Run Three Independent Evidence Passes",
    "## Step 3: Lead Reconciliation and Regrading",
    "## Report Output — Step 4: Render an Authorized Report",
    "## Step 5: Follow Up",
  ]);
});

test("Better Harness Skill exposes one evidence command and one render command", () => {
  const commandLines = textFenceLines(read(SKILL_PATH));
  const evidenceCommands = commandLines.filter((line) => line.startsWith("<cli> harness evidence-bundle "));
  const renderCommands = commandLines.filter((line) => line.startsWith("<cli> harness render "));

  assert.equal(evidenceCommands.length, 1);
  for (const option of [
    "--platform <provider>",
    "--workspace <target>",
    "--cwd <effective-cwd>",
    "--depth <quick|normal>",
    "--since <window-start>",
    "--until <window-end>",
    "--format json",
  ]) assert.equal(evidenceCommands[0].includes(option), true, `evidence command must include ${option}`);

  assert.equal(renderCommands.length, 1);
  for (const option of [
    "--findings <run-dir>/findings.json",
    "--mode <mode>",
    "--out <host-root>",
    "--run-dir <run-dir>",
    "--target <target>",
    "--validate",
    "--json",
  ]) assert.equal(renderCommands[0].includes(option), true, `render command must include ${option}`);
});

test("Better Harness Skill routes DSH through the shared evidence and durable renderer commands", () => {
  const commandLines = textFenceLines(read(SKILL_PATH));
  const evidenceCommands = commandLines.filter((line) => line.startsWith("<cli> harness evidence-bundle "));

  assert.equal(evidenceCommands.length, 1);
  assert.equal(evidenceCommands[0].includes("--platform <provider>"), true);
  assert.equal(evidenceCommands[0].includes("--workspace <target>"), true);
  assert.equal(evidenceCommands[0].includes("--cwd <effective-cwd>"), true);
  assert.equal(hostIdsFor(HOST_CAPABILITIES.EVIDENCE_BUNDLE).includes("dsh"), true);
  assert.equal(hostIdsFor(HOST_CAPABILITIES.REPORT_RENDERING).includes("dsh"), true);
  assert.equal(RENDER_REPORT_PLATFORMS.includes("dsh"), true);
});
