import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../scripts/harness-analysis/host-runtime/cli.mjs";

async function captureMain(argv, dependencies = {}) {
  const stdout = [];
  const stderr = [];
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = (chunk) => {
    stdout.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    stderr.push(String(chunk));
    return true;
  };
  try {
    const exitCode = await main(argv, dependencies);
    return { exitCode, stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

function fakeBundle(depth = "normal") {
  return {
    kind: "better-harness.evidence-bundle",
    schemaVersion: 2,
    status: "complete",
    context: { provider: "pi", depth, workspace: process.cwd() },
    lanes: {
      sessionEvidence: { status: "available", data: { lane: "session" } },
      projectHarness: { status: "available", data: { lane: "project" } },
      agentCustomize: { status: "available", data: { lane: "customize" } },
    },
    lead: { status: "available", data: { summary: "fixture" } },
    diagnostics: {},
  };
}

test("host-doctor emits a passing JSON contract for an accessible Pi workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-host-doctor-"));
  try {
    const result = await captureMain([
      "host-doctor",
      "--platform", "pi",
      "--workspace", root,
      "--model", "fixture-model",
      "--exclude-session-id", "fixture-session",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.status, "pass");
    assert.equal(payload.data.provider, "pi");
    assert.ok(payload.data.checks.some((check) => check.name === "runtime-resources" && check.status === "pass"));
    assert.equal(result.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host-doctor exposes fail status as ok=false while retaining diagnostic data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-host-doctor-fail-"));
  try {
    const result = await captureMain(["host-doctor", "--platform", "not-a-host", "--workspace", root]);
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.data.status, "fail");
    assert.ok(payload.data.checks.some((check) => check.name === "provider" && check.status === "fail"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepare-run writes only the bounded plan and verify-run dispatches it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-host-runtime-cli-"));
  const planPath = path.join(root, "run-plan.json");
  const resultsPath = path.join(root, "results.json");
  try {
    const prepared = await captureMain([
      "prepare-run",
      "--platform", "pi",
      "--workspace", process.cwd(),
      "--output", planPath,
    ], {
      collectEvidenceBundle: async () => fakeBundle("normal"),
    });
    assert.equal(prepared.exitCode, 0, prepared.stderr);
    const preparedPayload = JSON.parse(prepared.stdout);
    assert.equal(preparedPayload.ok, true);
    assert.deepEqual(preparedPayload.data.lanes, ["sessionEvidence", "projectHarness", "agentCustomize"]);
    const planEnvelope = JSON.parse(await readFile(planPath, "utf8"));
    const plan = planEnvelope.plan;
    const results = plan.expected.laneNames.map((lane, index) => ({
      lane,
      contextId: `fixture-${index}`,
      status: "completed",
      inputHash: plan.lanes[lane].inputHash,
      output: { findingCount: index },
    }));
    await import("node:fs/promises").then(({ writeFile }) => writeFile(resultsPath, `${JSON.stringify(results)}\n`));
    const verified = await captureMain([
      "verify-run",
      "--platform", "pi",
      "--plan", planPath,
      "--results", resultsPath,
    ]);
    assert.equal(verified.exitCode, 0, verified.stderr);
    const verifiedPayload = JSON.parse(verified.stdout);
    assert.equal(verifiedPayload.ok, true);
    assert.equal(verifiedPayload.data.results.length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
