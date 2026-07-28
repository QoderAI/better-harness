import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PROVIDER_COLLECTORS } from "../scripts/agent-customize/providers/index.mjs";
import { reportPlatform } from "../scripts/harness-analysis/report-run.mjs";
import { createAnalyzer } from "../scripts/session-analysis/index.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capabilityPath = path.join(repoRoot, "docs", "adapters", "capabilities.json");

async function capabilityDeclaration() {
  return JSON.parse(await readFile(capabilityPath, "utf8"));
}

test("host capability declaration is complete and uses the fixed status vocabulary", async () => {
  const declaration = await capabilityDeclaration();
  assert.equal(declaration.schemaVersion, 1);
  assert.deepEqual(declaration.statusVocabulary, ["yes", "partial", "no"]);
  assert.deepEqual(declaration.capabilities, [
    "configuredAssetInventory",
    "sessionEvidence",
    "portableDurableReport",
  ]);
  assert.deepEqual(Object.keys(declaration.hosts).sort(), ["claude", "codex", "cursor", "qoder"]);

  for (const [host, states] of Object.entries(declaration.hosts)) {
    for (const capability of declaration.capabilities) {
      assert.ok(declaration.statusVocabulary.includes(states[capability]), `${host}.${capability} must declare a known status`);
    }
  }
});

test("declared host capabilities have their implementation owners", async () => {
  const declaration = await capabilityDeclaration();
  for (const [host, states] of Object.entries(declaration.hosts)) {
    if (states.configuredAssetInventory === "yes") {
      assert.ok(PROVIDER_COLLECTORS.has(host), `${host} inventory support requires an agent-customize provider`);
    }
    if (states.sessionEvidence === "yes") {
      assert.ok(await createAnalyzer(host), `${host} session support requires a session analyzer`);
    }
    if (states.portableDurableReport === "yes") {
      assert.equal(reportPlatform(host), host, `${host} report support requires an accepted report platform`);
    }
  }
});

test("adapter matrix and Roadmap point to the capability declaration and describe its support", async () => {
  const [adapterMatrix, roadmap] = await Promise.all([
    readFile(path.join(repoRoot, "docs", "adapters", "README.md"), "utf8"),
    readFile(path.join(repoRoot, "roadmap.md"), "utf8"),
  ]);
  assert.match(adapterMatrix, /\[host capability declaration\]\(capabilities\.json\)/u);
  assert.match(roadmap, /\| Configured asset inventory \| Yes \| Yes \| Yes: unmatched plugin IDs remain unknown \| Yes \|/u);
  assert.match(roadmap, /\| Session evidence \| Yes \| Yes \| Yes: local coverage remains explicit \| Yes: local coverage remains explicit \|/u);
  assert.match(roadmap, /\| Durable report \| Qoder Canvas \| Markdown \+ HTML \| Markdown \+ HTML \| Markdown \+ HTML \|/u);
  assert.doesNotMatch(roadmap, /Keep session evidence unsupported\./u);
});
