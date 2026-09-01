import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "vitest";

import { POST } from "../app/api/upload/route.ts";
import { validateUploadPlan, validateUploadReceipt } from "../../../scripts/task-evidence-upload/index.mjs";
import { collectLocalDashboardData } from "../scripts/collect-local-data.mjs";
import { buildDashboardModel } from "../lib/dashboard-model.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const cli = path.join(root, "scripts", "better-harness.mjs");
const input = path.join(root, "packages", "harness-ui", "fixtures", "task-evidence-input.json");

/** Serve the real Next.js route handler over a loopback port. */
async function startDestination() {
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      try {
        const body = Buffer.concat(chunks);
        const result = await POST(new Request("http://127.0.0.1/api/upload", {
          method: request.method,
          headers: {
            "content-type": request.headers["content-type"] ?? "application/json",
            "content-length": String(body.byteLength),
          },
          body: body.byteLength > 0 ? body : undefined,
        }));
        response.writeHead(result.status, { "content-type": "application/json" });
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: "PROXY_FAILED", message: String(error) } }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/api/upload`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// The destination runs inside this process, so the CLI must be spawned
// asynchronously; a synchronous spawn would block the server it is calling.
function runCli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({ status: error?.code ?? 0, stdout, stderr });
    });
  });
}

let uploads;
let work;
let destination;
let previousUploads;

beforeEach(async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "harness-upload-e2e-"));
  // The store only holds records the destination wrote; local plan and receipt
  // artifacts stay outside it so they are never mistaken for stored evidence.
  uploads = path.join(temporary, "uploads");
  work = path.join(temporary, "work");
  previousUploads = process.env.BETTER_HARNESS_UPLOADS;
  process.env.BETTER_HARNESS_UPLOADS = uploads;
  destination = await startDestination();
});

afterEach(async () => {
  await destination.close();
  if (previousUploads === undefined) delete process.env.BETTER_HARNESS_UPLOADS;
  else process.env.BETTER_HARNESS_UPLOADS = previousUploads;
  await rm(path.dirname(uploads), { recursive: true, force: true });
});

test("a prepared plan is applied to its destination and reaches the Dashboard projection", async () => {
  const planPath = path.join(work, "plan.json");
  const receiptPath = path.join(work, "receipt.json");

  const prepared = await runCli([
    "upload", "plan",
    "--input", input,
    "--workspace", root,
    "--workspace-label", "better-harness-e2e",
    "--destination", destination.endpoint,
    "--organization", "acme-engineering",
    "--out", planPath,
    "--json",
  ]);
  assert.equal(prepared.status, 0, prepared.stderr);
  const preparedEnvelope = JSON.parse(prepared.stdout);
  assert.equal(preparedEnvelope.meta.network, "none");

  const plan = JSON.parse(await readFile(planPath, "utf8"));
  validateUploadPlan(plan);
  assert.equal(plan.effects.remoteMutation, false);
  assert.doesNotMatch(JSON.stringify(plan), /fixture-secret-value-123|Users\/example\/private-project/u);

  const applied = await runCli(["upload", "apply", "--plan", planPath, "--out", receiptPath, "--json"]);
  assert.equal(applied.status, 0, applied.stderr);
  const appliedEnvelope = JSON.parse(applied.stdout);
  assert.equal(appliedEnvelope.status, "ok");
  assert.equal(appliedEnvelope.command, "better-harness upload apply");
  assert.equal(appliedEnvelope.meta.network, "request");
  assert.equal(appliedEnvelope.data.receipt.state, "accepted");
  validateUploadReceipt(appliedEnvelope.data.receipt, { plan });

  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(receipt.packetDigest, plan.packetDigest);

  const repeated = await runCli(["upload", "apply", "--plan", planPath, "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).data.receipt.state, "duplicate");

  const collected = await collectLocalDashboardData({
    workspace: root,
    providers: [],
    uploadsDirectory: uploads,
  });
  assert.deepEqual(collected.sources.errors, []);
  assert.deepEqual(collected.evidencePackets.map((packet) => packet.task.id), ["TASK-42"]);

  const model = buildDashboardModel(collected);
  assert.deepEqual(model.evidencePackets.map((packet) => packet.id), ["TASK-42"]);
  assert.equal(model.evidencePackets[0].title, "Prepare Skill feedback");
  assert.equal(model.evidencePackets[0].workspace, "better-harness-e2e");
  assert.equal(model.evidencePackets[0].acceptance.unobserved, 1);
  assert.equal(model.evidencePackets[0].assets.unobserved, 1);
  assert.equal(model.evidencePackets[0].redactions >= 2, true);
});

test("the destination rejects a tampered plan and stores nothing", async () => {
  const planPath = path.join(work, "plan.json");
  const prepared = await runCli([
    "upload", "plan",
    "--input", input,
    "--workspace", root,
    "--destination", destination.endpoint,
    "--organization", "acme-engineering",
    "--out", planPath,
  ]);
  assert.equal(prepared.status, 0, prepared.stderr);

  const plan = JSON.parse(await readFile(planPath, "utf8"));
  plan.packet.task.title = "Rewritten before upload";
  const rejection = await POST(new Request("http://127.0.0.1/api/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(plan),
  }));

  assert.equal(rejection.status, 400);
  assert.equal((await rejection.json()).error.code, "PLAN_INTEGRITY_FAILED");

  const collected = await collectLocalDashboardData({
    workspace: root,
    providers: [],
    uploadsDirectory: uploads,
  });
  assert.deepEqual(collected.evidencePackets, []);
});

test("the destination refuses an organization it does not serve", async () => {
  const planPath = path.join(work, "plan.json");
  await runCli([
    "upload", "plan",
    "--input", input,
    "--workspace", root,
    "--destination", destination.endpoint,
    "--organization", "other-org",
    "--out", planPath,
  ]);

  const previous = process.env.BETTER_HARNESS_UPLOAD_ORGANIZATIONS;
  process.env.BETTER_HARNESS_UPLOAD_ORGANIZATIONS = "acme-engineering";
  try {
    const applied = await runCli(["upload", "apply", "--plan", planPath, "--json"]);
    assert.equal(applied.status, 1);
    const envelope = JSON.parse(applied.stdout);
    assert.equal(envelope.status, "failed");
    assert.equal(envelope.diagnostics[0].code, "UPLOAD_REJECTED");
    assert.match(envelope.diagnostics[0].hint, /ORGANIZATION_NOT_ALLOWED/u);
  } finally {
    if (previous === undefined) delete process.env.BETTER_HARNESS_UPLOAD_ORGANIZATIONS;
    else process.env.BETTER_HARNESS_UPLOAD_ORGANIZATIONS = previous;
  }

  const collected = await collectLocalDashboardData({
    workspace: root,
    providers: [],
    uploadsDirectory: uploads,
  });
  assert.deepEqual(collected.evidencePackets, []);
});
