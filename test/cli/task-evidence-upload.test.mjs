import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { resolveDispatch } from "../../scripts/better-harness-cli/cli.mjs";
import {
  canonicalJson,
  createEvidenceSanitizer,
  createUploadPlan,
  normalizeDestination,
  sha256Digest,
  validateUploadPlan,
} from "../../scripts/task-evidence-upload/index.mjs";
import { main } from "../../scripts/task-evidence-upload/cli.mjs";

const rootCli = path.join(process.cwd(), "scripts", "better-harness.mjs");
const fixedNow = new Date("2026-09-01T03:04:05.000Z");

function validInput({ workspace = process.cwd(), home = os.homedir(), secret = "super-secret-token" } = {}) {
  return {
    kind: "better-harness.task-evidence-input",
    schemaVersion: 1,
    task: {
      id: "TASK-42",
      title: "Prepare Skill feedback",
      intent: `Explain a failure observed under ${workspace}/packages and token=${secret}`,
      scope: ["scripts/task-evidence-upload"],
      nonGoals: ["send a remote request"],
      acceptance: [
        { id: "AC-1", status: "passed", summary: "The local plan validates." },
        { id: "AC-2", status: "unobserved", summary: `Remote receipt at ${home}/receipts is unavailable.` },
      ],
    },
    assets: [
      {
        kind: "skill",
        id: "publisher/skill-review",
        publisher: "publisher",
        revision: "sha256:abc123",
        match: "exact",
        stage: "executed",
        outcome: "failed",
        attribution: "associated",
        summary: `The task failed while the Skill was active at ${workspace}\\skill.log.`,
      },
      {
        kind: "mcp",
        id: "unknown-mcp",
        match: "unresolved",
        stage: "configured",
        outcome: "unobserved",
      },
    ],
    observations: [
      {
        kind: "validation",
        status: "failed",
        summary: "A focused validation command failed.",
        evidenceRef: "validation:test-1",
      },
      {
        kind: "human-review",
        status: "unobserved",
        summary: "No human review was recorded.",
      },
    ],
  };
}

function captureStreams() {
  const stdout = [];
  const stderr = [];
  return {
    stdout: { write: (value) => stdout.push(String(value)) },
    stderr: { write: (value) => stderr.push(String(value)) },
    stdoutText: () => stdout.join(""),
    stderrText: () => stderr.join(""),
  };
}

test("task evidence upload plan is redacted, uncertainty-preserving, and locally verifiable", () => {
  const workspace = "/private/work/better-harness";
  const home = "/Users/private-person";
  const secret = "credential-value-123";
  const plan = createUploadPlan({
    input: validInput({ workspace, home, secret }),
    destination: "https://harness.example.test/v1/task-evidence",
    organization: "org:platform",
    workspace,
    home,
    now: fixedNow,
  });

  assert.equal(plan.state, "prepared");
  assert.deepEqual(plan.effects, { localWrite: false, network: "none", remoteMutation: false });
  assert.equal(plan.packet.kind, "better-harness.task-evidence-packet");
  assert.equal(plan.packet.schemaVersion, 1);
  assert.deepEqual(plan.packet.coverage.acceptance, {
    total: 2,
    passed: 1,
    failed: 0,
    unobserved: 1,
  });
  assert.deepEqual(plan.packet.coverage.assetMatches, {
    total: 2,
    exact: 1,
    ambiguous: 0,
    unresolved: 1,
  });
  assert.equal(plan.packet.assets[0].outcome, "failed");
  assert.equal(plan.packet.assets[0].attribution, "associated");
  assert.equal(plan.packet.assets[1].outcome, "unobserved");
  assert.equal(plan.packet.assets[1].attribution, "not-applicable");
  assert.equal(plan.packet.privacy.redactions >= 3, true);

  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(serialized, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(serialized, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(serialized, new RegExp(secret, "u"));
  assert.match(serialized, /<private-path>/u);
  assert.match(serialized, /<redacted>/u);
  assert.deepEqual(plan.packet.privacy.excludedEvidence, [
    "sourceBodies",
    "prompts",
    "transcripts",
    "toolInputs",
    "toolOutputs",
    "credentials",
    "absolutePaths",
  ]);
  assert.equal(validateUploadPlan(plan), plan);
  assert.equal(plan.packetDigest, sha256Digest(canonicalJson(plan.packet)));
  assert.equal(plan.packetBytes, Buffer.byteLength(canonicalJson(plan.packet), "utf8"));
});

test("task evidence input fails closed for unknown fields and unsupported observation states", () => {
  const unknown = validInput();
  unknown.prompt = "raw prompt must not enter the allowlist";
  assert.throws(
    () => createUploadPlan({
      input: unknown,
      destination: "https://harness.example.test/evidence",
      organization: "org-1",
      now: fixedNow,
    }),
    (error) => error.code === "UNKNOWN_FIELD" && /input.*prompt/u.test(error.message),
  );

  const invalid = validInput();
  invalid.observations[0].status = "successful-ish";
  assert.throws(
    () => createUploadPlan({
      input: invalid,
      destination: "https://harness.example.test/evidence",
      organization: "org-1",
      now: fixedNow,
    }),
    (error) => error.code === "UNSUPPORTED_VALUE",
  );

  const overstated = validInput();
  overstated.assets[1].attribution = "confirmed";
  assert.throws(
    () => createUploadPlan({
      input: overstated,
      destination: "https://harness.example.test/evidence",
      organization: "org-1",
      now: fixedNow,
    }),
    (error) => error.code === "INVALID_ATTRIBUTION",
  );
});

test("upload plan validation detects packet and plan tampering", () => {
  const plan = createUploadPlan({
    input: validInput(),
    destination: "https://harness.example.test/evidence",
    organization: "org-1",
    now: fixedNow,
  });
  const packetTamper = structuredClone(plan);
  packetTamper.packet.task.title = "Changed after preparation";
  assert.throws(
    () => validateUploadPlan(packetTamper),
    (error) => error.code === "PLAN_INTEGRITY_FAILED",
  );

  const digestTamper = structuredClone(plan);
  digestTamper.packetDigest = sha256Digest("replacement");
  assert.throws(
    () => validateUploadPlan(digestTamper),
    (error) => error.code === "PLAN_INTEGRITY_FAILED",
  );
});

test("upload help returns before any input read or local write", async () => {
  const streams = captureStreams();
  let touched = false;
  const status = await main([
    "plan",
    "--input",
    "private-input.json",
    "--workspace",
    "private-workspace",
    "--help",
  ], {
    ...streams,
    read: async () => { touched = true; throw new Error("read called"); },
    write: async () => { touched = true; throw new Error("write called"); },
  });

  assert.equal(status, 0);
  assert.equal(touched, false);
  assert.equal(streams.stderrText(), "");
  assert.match(streams.stdoutText(), /This slice performs no network request/u);
  assert.doesNotMatch(streams.stdoutText(), /private-input/u);
});

test("upload plan JSON preview emits one document and performs no local write", async () => {
  const streams = captureStreams();
  let writeCount = 0;
  const status = await main([
    "plan",
    "--input",
    "task.json",
    "--workspace",
    ".",
    "--destination",
    "https://harness.example.test/evidence",
    "--organization",
    "org-1",
    "--json",
  ], {
    ...streams,
    now: () => fixedNow,
    read: async () => Buffer.from(JSON.stringify(validInput())),
    write: async () => { writeCount += 1; },
  });

  assert.equal(status, 0, streams.stderrText());
  assert.equal(streams.stderrText(), "");
  assert.equal(writeCount, 0);
  const payload = JSON.parse(streams.stdoutText());
  assert.equal(payload.command, "better-harness upload plan");
  assert.equal(payload.status, "ok");
  assert.deepEqual(payload.meta, { sideEffects: "none", network: "none" });
  assert.equal(payload.data.artifact, null);
  assert.equal(payload.data.plan.effects.localWrite, false);
});

test("upload plan writes one validated artifact only when out is explicit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-upload-plan-"));
  try {
    await writeFile(path.join(root, "task.json"), JSON.stringify(validInput({ workspace: root })));
    const streams = captureStreams();
    const status = await main([
      "plan",
      "--input",
      "task.json",
      "--workspace",
      ".",
      "--workspace-label",
      "sample-workspace",
      "--destination",
      "https://harness.example.test/evidence",
      "--organization",
      "org-1",
      "--out",
      "artifacts/upload-plan.json",
      "--json",
    ], {
      ...streams,
      cwd: root,
      now: () => fixedNow,
    });

    assert.equal(status, 0, streams.stderrText());
    const payload = JSON.parse(streams.stdoutText());
    assert.deepEqual(payload.meta, { sideEffects: "local-write", network: "none" });
    assert.deepEqual(payload.data.artifact, {
      written: true,
      path: "artifacts/upload-plan.json",
    });
    assert.equal(payload.data.plan.effects.localWrite, true);
    const saved = JSON.parse(await readFile(path.join(root, "artifacts", "upload-plan.json"), "utf8"));
    assert.equal(saved.packet.workspace.label, "sample-workspace");
    assert.deepEqual(saved, payload.data.plan);
    validateUploadPlan(saved);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("upload apply fails closed with a parser-safe diagnostic", async () => {
  const streams = captureStreams();
  let readCount = 0;
  const status = await main(["apply", "--json"], {
    ...streams,
    read: async () => { readCount += 1; },
  });

  assert.equal(status, 64);
  assert.equal(readCount, 0);
  assert.equal(streams.stderrText(), "");
  const payload = JSON.parse(streams.stdoutText());
  assert.equal(payload.command, "better-harness upload");
  assert.equal(payload.status, "failed");
  assert.equal(payload.meta.network, "none");
  assert.equal(payload.diagnostics[0].code, "UNKNOWN_SUBCOMMAND");
});

test("root CLI discovers and dispatches upload plan while rejecting upload apply", () => {
  const dispatch = resolveDispatch(["upload", "plan", "--json"]);
  assert.equal(dispatch.kind, "dispatch");
  assert.equal(path.basename(path.dirname(dispatch.script)), "task-evidence-upload");
  assert.deepEqual(dispatch.args, ["plan", "--json"]);

  for (const args of [["upload", "--help"], ["upload", "plan", "--help"]]) {
    const result = spawnSync(process.execPath, [rootCli, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /task evidence upload/iu);
  }

  const apply = spawnSync(process.execPath, [rootCli, "upload", "apply", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(apply.status, 64, apply.stderr);
  assert.equal(apply.stderr, "");
  assert.equal(JSON.parse(apply.stdout).diagnostics[0].code, "UNKNOWN_SUBCOMMAND");
});

test("evidence sanitizer covers POSIX, Windows drive, and UNC absolute paths", () => {
  const sanitizer = createEvidenceSanitizer({
    workspace: "C:\\work\\better-harness",
    home: "C:\\Users\\person",
  });
  const output = sanitizer.sanitize(
    "C:\\work\\better-harness\\a.txt C:\\Users\\person\\b.txt \\\\server\\share\\c.txt /var/tmp/d.txt",
  );
  assert.doesNotMatch(output, /C:\\work/u);
  assert.doesNotMatch(output, /C:\\Users/u);
  assert.doesNotMatch(output, /server\\share/u);
  assert.doesNotMatch(output, /\/var\/tmp/u);
  assert.equal(sanitizer.redactionCount, 4);
});

test("destination contract requires HTTPS except for loopback planning", () => {
  assert.equal(
    normalizeDestination("https://harness.example.test/evidence"),
    "https://harness.example.test/evidence",
  );
  assert.equal(normalizeDestination("http://127.0.0.1:8080/evidence"), "http://127.0.0.1:8080/evidence");
  assert.throws(
    () => normalizeDestination("http://harness.example.test/evidence"),
    (error) => error.code === "INVALID_DESTINATION",
  );
  assert.throws(
    () => normalizeDestination("https://harness.example.test/evidence?token=secret"),
    (error) => error.code === "INVALID_DESTINATION",
  );
});
