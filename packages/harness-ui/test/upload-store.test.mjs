import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "vitest";

import { createUploadPlan } from "../../../scripts/task-evidence-upload/index.mjs";
import {
  DEFAULT_UPLOADS_SEGMENTS,
  readUploadPackets,
  readUploadRecords,
  resolveUploadsDirectory,
  storeUploadPlan,
} from "../scripts/upload-store.mjs";

const input = {
  kind: "better-harness.task-evidence-input",
  schemaVersion: 1,
  task: {
    id: "TASK-7",
    title: "Close the upload loop",
    intent: "Store applied evidence where the Dashboard reads it.",
    scope: ["packages/harness-ui"],
    nonGoals: ["authentication"],
    acceptance: [{ id: "AC-1", status: "passed", summary: "The record round-trips." }],
  },
  assets: [{
    kind: "skill",
    id: "better-harness",
    match: "exact",
    stage: "executed",
    outcome: "succeeded",
  }],
  observations: [{ kind: "validation", status: "passed", summary: "Focused tests pass." }],
};

function planFor(taskId, workspace) {
  return createUploadPlan({
    input: { ...input, task: { ...input.task, id: taskId } },
    destination: "https://harness.example.test/evidence",
    organization: "acme-engineering",
    workspace,
    workspaceLabel: "fixture-workspace",
    now: new Date("2026-09-01T10:00:00.000Z"),
  });
}

let directory;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "harness-upload-store-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("uploads directory prefers an explicit path, then the environment, then the workspace", () => {
  const workspace = path.join(path.sep, "work", "repo");
  assert.equal(
    resolveUploadsDirectory({ workspace, uploadsDirectory: path.join(path.sep, "tmp", "explicit"), env: {} }),
    path.resolve(path.join(path.sep, "tmp", "explicit")),
  );
  assert.equal(
    resolveUploadsDirectory({ workspace, env: { BETTER_HARNESS_UPLOADS: path.join(path.sep, "tmp", "from-env") } }),
    path.resolve(path.join(path.sep, "tmp", "from-env")),
  );
  assert.equal(
    resolveUploadsDirectory({ workspace, env: {} }),
    path.join(path.resolve(workspace), ...DEFAULT_UPLOADS_SEGMENTS),
  );
});

test("a stored plan is content-addressed and a repeat apply reports the first acceptance", async () => {
  const plan = planFor("TASK-7", directory);
  const first = await storeUploadPlan(plan, { directory, now: new Date("2026-09-01T11:00:00.000Z") });

  assert.equal(first.state, "accepted");
  assert.equal(first.receipt.state, "accepted");
  assert.equal(first.receipt.packetDigest, plan.packetDigest);
  assert.equal(first.receipt.planDigest, plan.planDigest);
  assert.equal(first.receipt.acceptedAt, "2026-09-01T11:00:00.000Z");
  assert.equal(path.basename(first.path), `${plan.packetDigest.slice("sha256:".length)}.json`);

  const second = await storeUploadPlan(plan, { directory, now: new Date("2026-09-01T12:00:00.000Z") });
  assert.equal(second.state, "duplicate");
  assert.equal(second.receipt.state, "duplicate");
  assert.equal(second.receipt.acceptedAt, "2026-09-01T11:00:00.000Z");
  assert.equal(second.receipt.receiptId, first.receipt.receiptId);
  assert.notEqual(second.receipt.receiptDigest, first.receipt.receiptDigest);

  const stored = await readdir(directory);
  assert.deepEqual(stored, [path.basename(first.path)]);
});

test("stored records read back newest first as Dashboard packets", async () => {
  await storeUploadPlan(planFor("TASK-7", directory), { directory, now: new Date("2026-09-01T11:00:00.000Z") });
  await storeUploadPlan(planFor("TASK-8", directory), { directory, now: new Date("2026-09-01T13:00:00.000Z") });

  const { records, errors } = await readUploadRecords({ directory });
  assert.deepEqual(errors, []);
  assert.deepEqual(records.map((record) => record.plan.packet.task.id), ["TASK-8", "TASK-7"]);

  const packets = await readUploadPackets({ directory, limit: 1 });
  assert.deepEqual(packets.packets.map((packet) => packet.task.id), ["TASK-8"]);
  assert.equal(packets.packets[0].kind, "better-harness.task-evidence-packet");
});

test("a missing directory reads as no evidence while an unreadable record is reported", async () => {
  const missing = await readUploadRecords({ directory: path.join(directory, "absent") });
  assert.deepEqual(missing, { records: [], errors: [] });

  await storeUploadPlan(planFor("TASK-7", directory), { directory });
  await writeFile(path.join(directory, "broken.json"), "{ not json", "utf8");

  const { records, errors } = await readUploadRecords({ directory });
  assert.deepEqual(records.map((record) => record.plan.packet.task.id), ["TASK-7"]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].source, "uploads:broken.json");
});

test("a tampered record is rejected instead of reaching the Dashboard", async () => {
  const plan = planFor("TASK-7", directory);
  const stored = await storeUploadPlan(plan, { directory });
  const record = JSON.parse(await readFile(stored.path, "utf8"));
  record.plan.packet.task.title = "Rewritten after acceptance";
  await writeFile(stored.path, JSON.stringify(record), "utf8");

  const { records, errors } = await readUploadRecords({ directory });
  assert.deepEqual(records, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /packetDigest|packetBytes/u);
});
