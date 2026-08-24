import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = process.cwd();
const CLI = path.join(ROOT, "scripts", "harness-component-snapshot", "cli.mjs");
const FIXTURE = path.join(ROOT, "test", "fixtures", "harness-component-snapshot", "project");

async function fixtureWorkspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-component-cli-"));
  const workspace = path.join(root, "workspace");
  await cp(FIXTURE, workspace, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, workspace };
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });
}

test("direct CLI provides global and leaf help without performing work", () => {
  for (const args of [["--help"], ["create", "--help"], ["validate", "--help"], ["diff", "--help"], ["resolve", "--help"]]) {
    const result = run(args);
    assert.equal(result.status, 0, `${args.join(" ")} failed: ${result.stderr}`);
    assert.match(result.stdout, /create.*validate.*diff.*resolve/su);
    assert.equal(result.stderr, "");
  }

  for (const args of [["bogus", "--help"], ["--help", "trailing"], ["create", "--help", "trailing"]]) {
    const result = run(args);
    assert.equal(result.status, 64, `${args.join(" ")} unexpectedly succeeded`);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^INVALID_USAGE: unrecognized (command|option)\n$/u);
  }

  const privatePath = path.join(os.tmpdir(), "PRIVATE-USAGE-PATH-SENTINEL", "snapshot.json");
  for (const args of [[privatePath], ["validate", privatePath]]) {
    const result = run(args);
    assert.equal(result.status, 64);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^INVALID_USAGE: unrecognized (command|option)\n$/u);
    assert.equal(result.stderr.includes(privatePath), false);
    assert.equal(result.stderr.includes("PRIVATE-USAGE-PATH-SENTINEL"), false);
  }
});

test("direct CLI names allowlisted flags in usage failures without echoing their values", async (t) => {
  const { workspace } = await fixtureWorkspace(t);
  const privateValue = path.join(os.tmpdir(), "PRIVATE-FLAG-VALUE-SENTINEL", "snapshot.json");

  const missingValue = run(["create", "--workspace"]);
  assert.equal(missingValue.status, 64);
  assert.equal(missingValue.stderr, "INVALID_USAGE: missing option value: --workspace\n");

  const duplicate = run(["create", "--workspace", workspace, "--workspace", privateValue]);
  assert.equal(duplicate.status, 64);
  assert.equal(duplicate.stderr, "INVALID_USAGE: duplicate option: --workspace\n");
  assert.equal(duplicate.stderr.includes(privateValue), false);

  const missingRequired = run(["validate"]);
  assert.equal(missingRequired.status, 64);
  assert.equal(missingRequired.stderr, "INVALID_USAGE: missing required option: --snapshot\n");
});

test("direct CLI creates parser-safe private JSON and rejects unknown options", async (t) => {
  const { workspace } = await fixtureWorkspace(t);
  const created = run([
    "create",
    "--workspace",
    workspace,
    "--provider",
    "qoder",
    "--population-key",
    "portable-cli-project",
  ]);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(created.stderr, "");
  const snapshot = JSON.parse(created.stdout);
  assert.equal(snapshot.kind, "HarnessComponentSnapshotV1");
  assert.equal(created.stdout.includes(workspace), false);
  assert.equal(created.stdout.includes("PRIVATE-HOME-SENTINEL"), false);
  assert.equal(created.stdout.includes("portable-cli-project"), false);

  const invalid = run(["create", "--workspace", workspace, "--unknown", "value"]);
  assert.equal(invalid.status, 64);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /^INVALID_USAGE:/u);
});

test("direct CLI validates, diffs, and resolves snapshot artifacts", async (t) => {
  const { root, workspace } = await fixtureWorkspace(t);
  const created = run(["create", "--workspace", workspace]);
  assert.equal(created.status, 0, created.stderr);
  const beforePath = path.join(root, "before.json");
  const afterPath = path.join(root, "after.json");
  await writeFile(beforePath, created.stdout, "utf8");
  await writeFile(afterPath, created.stdout, "utf8");

  const validated = run(["validate", "--snapshot", beforePath]);
  assert.equal(validated.status, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).valid, true);

  const diffed = run(["diff", "--before", beforePath, "--after", afterPath, "--limit", "1"]);
  assert.equal(diffed.status, 0, diffed.stderr);
  const diff = JSON.parse(diffed.stdout);
  assert.equal(diff.counts.changed, 0);
  assert.equal(diff.truncated, true);
  assert.equal(diff.entries.length, 1);

  const snapshot = JSON.parse(created.stdout);
  const resolved = run([
    "resolve",
    "--snapshot",
    beforePath,
    "--reference",
    snapshot.components[0].rollbackReference,
  ]);
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(JSON.parse(resolved.stdout).mutationAuthorized, false);

  const tampered = JSON.parse(created.stdout);
  tampered.components[0].route = "changed.md";
  const tamperedPath = path.join(root, "tampered.json");
  await writeFile(tamperedPath, JSON.stringify(tampered), "utf8");
  const rejected = run(["validate", "--snapshot", tamperedPath]);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, "");
  assert.equal(rejected.stderr, "COMPONENT_ID_MISMATCH: component snapshot operation failed\n");
  assert.equal(rejected.stderr.includes("changed.md"), false);

  const privateMissingPath = path.join(root, "PRIVATE-PATH-SENTINEL", "missing.json");
  const missing = run(["validate", "--snapshot", privateMissingPath]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr, "SNAPSHOT_READ_FAILED: component snapshot operation failed\n");
  assert.equal(missing.stderr.includes(privateMissingPath), false);
});
