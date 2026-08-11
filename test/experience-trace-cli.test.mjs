import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createHarnessReportSource } from "../scripts/harness-analysis/report-source.mjs";
import { buildObservationManifest } from "../scripts/session-analysis/observation-manifest.mjs";

const ROOT = process.cwd();
const LEAF = path.join(ROOT, "scripts", "experience-trace", "cli.mjs");
const ROOT_CLI = path.join(ROOT, "scripts", "better-harness.mjs");
const TASK_KEY = "task-key-00000001";
const WORKSPACE_KEY = "workspace-key-00000001";
const RUN_KEY = "run-key-00000001";
const PRIVATE_SENTINEL = "private-experience-trace-sentinel";
const ERROR_MESSAGES = Object.freeze({
  INVALID_USAGE: "invalid experience-trace arguments",
  MISSING_EPISODE_SELECTION: "select exactly one episode mode",
  INVALID_TRACE_BINDING: "trace binding key is invalid",
  SOURCE_READ_FAILED: "unable to read report source",
  TRACE_READ_FAILED: "unable to read experience trace",
  TRACE_BOUNDS_EXCEEDED: "experience trace bounds exceeded",
  INVALID_REPORT_SOURCE: "report source is invalid",
  UNSUPPORTED_TRACE_SOURCE_VERSION: "report source version is unsupported",
  UNSUPPORTED_TRACE_PLATFORM: "report source platform is unsupported",
  UNKNOWN_EPISODE_REF: "selected episode is unavailable",
  INVALID_EXPERIENCE_TRACE: "experience trace is invalid",
});

function run(entrypoint, args, options = {}) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
}

function runLeaf(args, options) {
  return run(LEAF, args, options);
}

function runRoot(args, options) {
  return run(ROOT_CLI, args, options);
}

async function withTemporaryDirectory(runTest) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "better-harness-experience-trace-"));
  try {
    return await runTest(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function validNoSessionSource({ warnings = [] } = {}) {
  const manifest = buildObservationManifest({
    scope: { platform: "qoder", workspace: "fixture-workspace" },
    sources: [{
      id: "qoder-fixture",
      kind: "project-jsonl",
      enabled: true,
      exists: true,
      optional: false,
      workspaceScoped: true,
    }],
    warnings: warnings.map((code) => ({ code })),
    eligibleCount: 0,
    analyzedCount: 0,
    selectionStrategy: "all-eligible",
  });
  manifest.sources.fingerprint = "0123456789abcdef";
  return createHarnessReportSource({
    manifest,
    repositoryEvidence: {},
    sessionEvents: {},
    taskEpisodes: [],
    deliveryEvidence: [],
    semanticFacets: [],
    interventionLedger: [],
    evidenceRefs: [],
    assessmentDecisions: [],
  });
}

function createArgs(sourcePath, extra = []) {
  return [
    "create",
    "--source", sourcePath,
    "--task-key", TASK_KEY,
    "--workspace-key", WORKSPACE_KEY,
    "--run-key", RUN_KEY,
    "--no-session-evidence",
    "--jsonl",
    ...extra,
  ];
}

function assertFailure(result, { code, exitCode = 1, privateValue } = {}) {
  assert.equal(result.status, exitCode, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `${code}: ${ERROR_MESSAGES[code]}\n`);
  if (privateValue) assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(privateValue, "u"));
}

test("create and validate round-trip through direct and root commands without writing artifacts", async () => {
  await withTemporaryDirectory(async (directory) => {
    const sourcePath = path.join(directory, "report.source.json");
    const tracePath = path.join(directory, "captured.trace.jsonl");
    await writeFile(sourcePath, JSON.stringify(validNoSessionSource()));

    const directCreate = runLeaf(createArgs(sourcePath));
    assert.equal(directCreate.status, 0, directCreate.stderr);
    assert.equal(directCreate.signal, null);
    assert.equal(directCreate.stderr, "");
    assert.equal(directCreate.stdout.endsWith("\n"), true);
    assert.equal((await readdir(directory)).sort().join(","), "report.source.json");

    const rootCreate = runRoot(["harness", "experience-trace", ...createArgs(sourcePath)]);
    assert.equal(rootCreate.status, 0, rootCreate.stderr);
    assert.equal(rootCreate.stderr, "");
    assert.equal(rootCreate.stdout, directCreate.stdout);
    assert.equal((await readdir(directory)).sort().join(","), "report.source.json");

    await writeFile(tracePath, directCreate.stdout);
    const directValidate = runLeaf(["validate", "--trace", tracePath]);
    const rootValidate = runRoot(["harness", "experience-trace", "validate", "--trace", tracePath]);
    assert.equal(directValidate.status, 0, directValidate.stderr);
    assert.equal(directValidate.stderr, "");
    assert.equal(rootValidate.status, 0, rootValidate.stderr);
    assert.equal(rootValidate.stderr, "");
    assert.equal(rootValidate.stdout, directValidate.stdout);
    const validation = JSON.parse(directValidate.stdout);
    assert.deepEqual(Object.keys(validation), [
      "eventCount", "evidenceStatus", "kind", "recordCount", "schemaVersion",
      "streamStatus", "traceDigest", "traceId", "valid",
    ]);
    assert.equal(validation.valid, true);
    assert.equal(validation.evidenceStatus, "unavailable");
    assert.equal((await readdir(directory)).sort().join(","), "captured.trace.jsonl,report.source.json");
  });
});

test("help is exact and strict parser failures do not read or echo private arguments", async () => {
  await withTemporaryDirectory(async (directory) => {
    const privatePath = path.join(directory, `${PRIVATE_SENTINEL}.json`);
    for (const argv of [["--help"], ["-h"], ["create", "--help"], ["validate", "-h"]]) {
      const result = runLeaf(argv);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, /^Better Harness Experience Trace v1/mu);
    }

    const invalidCases = [
      ["bogus"],
      ["create", "--help", "trailing"],
      ["create", "--source"],
      ["create", "--source", privatePath, "--task-key", TASK_KEY, "--workspace-key", WORKSPACE_KEY, "--run-key", RUN_KEY, "--no-session-evidence"],
      [...createArgs(privatePath), "--source", privatePath],
      [...createArgs(privatePath), "--no-session-evidence"],
      ["create", "--source", privatePath, "--task-key", TASK_KEY, "--workspace-key", WORKSPACE_KEY, "--run-key", RUN_KEY, "--episode-ref", "episode:111111111111", "--no-session-evidence", "--jsonl"],
      ["validate", "--trace", privatePath, "--unknown"],
    ];
    for (const argv of invalidCases) {
      assertFailure(runLeaf(argv), { code: "INVALID_USAGE", exitCode: 64, privateValue: PRIVATE_SENTINEL });
    }

    assertFailure(runLeaf(createArgs(privatePath)), {
      code: "SOURCE_READ_FAILED",
      privateValue: PRIVATE_SENTINEL,
    });
    assertFailure(runLeaf(["validate", "--trace", privatePath]), {
      code: "TRACE_READ_FAILED",
      privateValue: PRIVATE_SENTINEL,
    });
  });
});

test("invalid source, private warning, deep trace, and oversized files fail before any stdout", async () => {
  await withTemporaryDirectory(async (directory) => {
    const sourcePath = path.join(directory, "source.json");
    const warningPath = path.join(directory, "warning.json");
    const unsupportedVersionPath = path.join(directory, "unsupported-version.json");
    const unsupportedPlatformPath = path.join(directory, "unsupported-platform.json");
    const invalidUtf8SourcePath = path.join(directory, "invalid-utf8.json");
    const invalidUtf8TracePath = path.join(directory, "invalid-utf8.jsonl");
    const deepTracePath = path.join(directory, "deep.jsonl");
    const oversizedTracePath = path.join(directory, "oversized.jsonl");
    const oversizedSourcePath = path.join(directory, "oversized-source.json");
    await writeFile(sourcePath, JSON.stringify(validNoSessionSource()));
    await writeFile(warningPath, JSON.stringify(validNoSessionSource({ warnings: [PRIVATE_SENTINEL] })));
    const unsupportedVersion = validNoSessionSource();
    unsupportedVersion.schemaVersion = 4;
    await writeFile(unsupportedVersionPath, JSON.stringify(unsupportedVersion));
    const unsupportedPlatform = validNoSessionSource();
    unsupportedPlatform.manifest.scope.platform = "codex";
    await writeFile(unsupportedPlatformPath, JSON.stringify(unsupportedPlatform));
    await writeFile(invalidUtf8SourcePath, Buffer.from([0xff]));
    await writeFile(invalidUtf8TracePath, Buffer.from([0xff]));

    let deep = null;
    for (let index = 0; index <= 64; index += 1) deep = { next: deep };
    await writeFile(deepTracePath, `${JSON.stringify(deep)}\n`);
    await writeFile(oversizedTracePath, Buffer.alloc(1024 * 1024 + 1, 0x61));
    await writeFile(oversizedSourcePath, Buffer.alloc(16 * 1024 * 1024 + 1, 0x20));

    assertFailure(runLeaf(createArgs(warningPath)), {
      code: "INVALID_REPORT_SOURCE",
      privateValue: PRIVATE_SENTINEL,
    });
    assertFailure(runLeaf(createArgs(invalidUtf8SourcePath)), { code: "INVALID_REPORT_SOURCE" });
    assertFailure(runLeaf(["validate", "--trace", invalidUtf8TracePath]), { code: "INVALID_EXPERIENCE_TRACE" });
    assertFailure(runRoot(["harness", "experience-trace", "validate", "--trace", invalidUtf8TracePath]), {
      code: "INVALID_EXPERIENCE_TRACE",
    });
    assertFailure(runLeaf(["validate", "--trace", deepTracePath]), { code: "INVALID_EXPERIENCE_TRACE" });
    assertFailure(runLeaf(["validate", "--trace", oversizedTracePath]), { code: "TRACE_BOUNDS_EXCEEDED" });
    assertFailure(runLeaf(createArgs(oversizedSourcePath)), { code: "TRACE_BOUNDS_EXCEEDED" });

    for (const [pathValue, code] of [
      [unsupportedVersionPath, "UNSUPPORTED_TRACE_SOURCE_VERSION"],
      [unsupportedPlatformPath, "UNSUPPORTED_TRACE_PLATFORM"],
    ]) {
      assertFailure(runLeaf([
        "create",
        "--source", pathValue,
        "--task-key", TASK_KEY,
        "--workspace-key", WORKSPACE_KEY,
        "--run-key", RUN_KEY,
        "--episode-ref", "episode:not-valid",
        "--jsonl",
      ]), { code });
    }

    const absentEpisode = runLeaf([
      "create",
      "--source", sourcePath,
      "--task-key", TASK_KEY,
      "--workspace-key", WORKSPACE_KEY,
      "--run-key", RUN_KEY,
      "--episode-ref", "episode:111111111111",
      "--jsonl",
    ]);
    assertFailure(absentEpisode, { code: "UNKNOWN_EPISODE_REF" });
  });
});

test("shared line, record, and event bounds keep the public CLI error stable and private", async () => {
  await withTemporaryDirectory(async (directory) => {
    const overlongLinePath = path.join(directory, `overlong-line-${PRIVATE_SENTINEL}.jsonl`);
    const tooManyRecordsPath = path.join(directory, `too-many-records-${PRIVATE_SENTINEL}.jsonl`);
    const tooManyEventsPath = path.join(directory, `too-many-events-${PRIVATE_SENTINEL}.jsonl`);

    const invalidUtf8 = Buffer.from([0xff]);
    const overlongUtf8Line = Buffer.concat([
      Buffer.from(JSON.stringify("界".repeat(21_846)), "utf8"),
      invalidUtf8,
    ]);
    assert.equal(overlongUtf8Line.length > 65_536, true);
    await writeFile(overlongLinePath, Buffer.concat([
      Buffer.from("{}\n"),
      overlongUtf8Line,
      Buffer.from("\n{}\n"),
    ]));
    await writeFile(tooManyRecordsPath, Buffer.concat([
      Buffer.from(Array.from({ length: 256 }, () => "{}\n").join("")),
      invalidUtf8,
      Buffer.from("\n"),
    ]));
    await writeFile(tooManyEventsPath, Buffer.concat([
      Buffer.from(`${[
        JSON.stringify({ kind: "better-harness.experience-trace.header" }),
        ...Array.from({ length: 65 }, () => JSON.stringify({ kind: "better-harness.experience-trace.event" })),
      ].join("\n")}\n`),
      invalidUtf8,
      Buffer.from("\n"),
    ]));

    for (const tracePath of [overlongLinePath, tooManyRecordsPath, tooManyEventsPath]) {
      for (const result of [
        runLeaf(["validate", "--trace", tracePath]),
        runRoot(["harness", "experience-trace", "validate", "--trace", tracePath]),
      ]) {
        assertFailure(result, {
          code: "TRACE_BOUNDS_EXCEEDED",
          privateValue: PRIVATE_SENTINEL,
        });
      }
    }
  });
});

test("under-bound missing final LF remains invalid through direct and root validation", async () => {
  await withTemporaryDirectory(async (directory) => {
    const tracePath = path.join(directory, `missing-final-lf-${PRIVATE_SENTINEL}.jsonl`);
    const fixture = await readFile(path.join(
      ROOT,
      "docs",
      "specs",
      "fixtures",
      "lc03-no-session-v1.jsonl",
    ));
    assert.equal(fixture.at(-1), 0x0a);
    await writeFile(tracePath, fixture.subarray(0, -1));

    for (const result of [
      runLeaf(["validate", "--trace", tracePath]),
      runRoot(["harness", "experience-trace", "validate", "--trace", tracePath]),
    ]) {
      assertFailure(result, {
        code: "INVALID_EXPERIENCE_TRACE",
        privateValue: PRIVATE_SENTINEL,
      });
    }
  });
});

test("event bounds win when the terminal record is unterminated", async () => {
  await withTemporaryDirectory(async (directory) => {
    const tracePath = path.join(directory, `unterminated-event-overflow-${PRIVATE_SENTINEL}.jsonl`);
    const trace = [
      JSON.stringify({ kind: "better-harness.experience-trace.header" }),
      ...Array.from(
        { length: 65 },
        () => JSON.stringify({ kind: "better-harness.experience-trace.event" }),
      ),
      JSON.stringify({ kind: "better-harness.experience-trace.terminal" }),
    ].join("\n");
    assert.equal(trace.endsWith("\n"), false);
    assert.equal(trace.match(/\n/gu)?.length, 66);
    assert.equal(Buffer.byteLength(trace, "utf8") < 1024 * 1024, true);
    await writeFile(tracePath, trace);

    for (const result of [
      runLeaf(["validate", "--trace", tracePath]),
      runRoot(["harness", "experience-trace", "validate", "--trace", tracePath]),
    ]) {
      assertFailure(result, {
        code: "TRACE_BOUNDS_EXCEEDED",
        privateValue: PRIVATE_SENTINEL,
      });
    }
  });
});
