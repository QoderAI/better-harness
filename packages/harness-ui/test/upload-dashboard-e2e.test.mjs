import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { validateUploadPlan } from "../../../scripts/task-evidence-upload/index.mjs";
import { buildUsageSummary } from "../../../scripts/session-analysis/usage-summary.mjs";
import { buildDashboardModel } from "../lib/dashboard-model.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const cli = path.join(root, "scripts", "better-harness.mjs");
const input = path.join(root, "packages", "harness-ui", "fixtures", "task-evidence-input.json");

test("upload plan flows from the real CLI into the Dashboard projection", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "harness-upload-dashboard-"));
  const output = path.join(temporary, "upload-plan.json");

  try {
    const result = spawnSync(process.execPath, [
      cli,
      "upload", "plan",
      "--input", input,
      "--workspace", root,
      "--workspace-label", "better-harness-e2e",
      "--destination", "http://127.0.0.1:3410/api/upload",
      "--organization", "acme-engineering",
      "--out", output,
      "--json",
    ], { cwd: root, encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.status, "ok");
    assert.equal(envelope.meta.network, "none");
    assert.equal(envelope.data.artifact.written, true);

    const plan = JSON.parse(await readFile(output, "utf8"));
    validateUploadPlan(plan);
    assert.equal(plan.effects.remoteMutation, false);
    assert.equal(plan.packet.task.id, "TASK-42");
    assert.equal(plan.packet.privacy.redactions >= 2, true);
    assert.doesNotMatch(JSON.stringify(plan), /fixture-secret-value-123|Users\/example\/private-project/u);

    const model = buildDashboardModel({
      generatedAt: "2026-09-01T12:10:00.000Z",
      sources: { sessionProviders: [], assetProviders: [], tokenProviders: [], errors: [] },
      usageSummary: buildUsageSummary({}),
      usageActivity: {
        schemaVersion: 3,
        dateBasis: "UTC",
        measurementBasis: "session-starts-active-estimate-model-active-session-days-skill-invocations-loads-and-observed-token-usage",
        truncated: false,
        dates: [],
        sessions: { total: 0, starts: [], activeMinutes: [] },
        models: [],
        skills: [],
      },
      assetInventories: [],
      evidencePackets: [plan.packet],
    });
    assert.deepEqual(model.evidencePackets.map((packet) => packet.id), ["TASK-42"]);
    assert.equal(model.evidencePackets[0].title, "Prepare Skill feedback");
    assert.equal(model.evidencePackets[0].acceptance.unobserved, 1);
    assert.equal(model.evidencePackets[0].assets.unobserved, 1);
    assert.equal(model.evidencePackets[0].redactions >= 2, true);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
